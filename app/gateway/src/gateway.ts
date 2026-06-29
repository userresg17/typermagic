// app/gateway/gateway.ts
// O motor do gateway. Por mensagem recebida: (1) se há uma PERGUNTA pendente p/ aquele
// chat (aprovação/esclarecimento/OTP), a mensagem é a RESPOSTA — resolve e sai; (2) senão,
// allowlist por remetente (default-deny), (3) rate-limit, (4) roda a tarefa pela Engine
// numa superfície gateway:<canal> capability-scoped, e (5) transmite a resposta.
//
// A diferença p/ a versão autônoma: a superfície NÃO é mais "never" — usa approval
// "always", então ação irreversível (pagar/enviar/logar) NÃO é negada de cara: ela
// PERGUNTA no canal (HITL) e ESPERA o seu SIM/NÃO. Pra isso o loop de polling do canal
// chama handle() sem bloquear (fire-and-forget), e a pendência é casada com a próxima
// mensagem do mesmo chat (PendingStore).

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createEngine, type CapabilityGrant, type EngineEvent } from "@typer/engine";
import { openBrowser, type BrowserSession } from "@typer/agent";
import { openVault, type Vault } from "@typer/vault";
import { RateLimiter } from "./rate-limit.js";
import { PendingStore, type PendingKind } from "./pending.js";
import type { ChannelAdapter, GatewayConfig, IncomingMessage } from "./types.js";

/** Mata navegadores ÓRFÃOS do bot (pelo perfil .typer — não toca no navegador real do
 *  usuário) e remove locks obsoletos do perfil. Roda antes de abrir um navegador novo, p/
 *  não acumular processos nem travar no SingletonLock de um Brave que morreu no SIGKILL. */
function cleanupStaleBrowser(profileDir: string): void {
  try {
    spawnSync("pkill", ["-9", "-f", ".typer/browser/profile"], { stdio: "ignore" });
  } catch {
    /* sem pkill (não-linux): tudo bem */
  }
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      rmSync(join(profileDir, f), { force: true });
    } catch {
      /* ok */
    }
  }
}

export interface GatewayHooks {
  /** observabilidade: chamado a cada mensagem processada */
  onAudit?: (e: { sender: string; result: "ok" | "denied" | "rate_limited" | "error"; detail?: string }) => void;
}

/** ApprovalRequest da Engine (forma estrutural — evita acoplar o import). */
interface ApprovalLike {
  action: string;
  target: string;
  detail?: string;
  attempt?: number;
}

/** Quanto tempo esperar uma resposta do usuário antes de cancelar por segurança. */
const ASK_TIMEOUT_MS = 5 * 60_000;

/** Teto de confirmações HITL por tarefa — evita o loop de "confirma de novo" quando a
 *  página não finaliza (anti-bot). Depois disso, para e avisa em vez de pedir mais. */
const MAX_APPROVALS_PER_TASK = 2;

/** Reconhece um "sim" (aprovação). Qualquer outra coisa = não aprovado. */
const AFFIRMATIVE = /^\s*(sim|s|yes|y|ok|confirmo|confirmar|confirmado|aprovar|aprovo|pode|manda)\b/i;

/** Comandos do gateway (escrevem no cofre direto, sem passar pelo modelo). */
const COMMANDS = ["/setup", "/set", "/vault", "/forget", "/reset", "/status", "/help"];
/** 1º token do comando, normalizado — tira o sufixo @nomedobot que o Telegram anexa. */
function commandOf(text: string): string {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first.split("@")[0]!;
}
function isCommand(text: string): boolean {
  return COMMANDS.includes(commandOf(text));
}

/** Onboarding: campos perguntados em sequência no /setup. "pular" deixa em branco. */
const SETUP_FIELDS: Array<{ key: string; q: string }> = [
  { key: "name", q: "Seu nome completo?" },
  { key: "email", q: "Seu e-mail (ex.: Gmail)?" },
  { key: "phone", q: "Telefone (com DDD)?" },
  { key: "cpf", q: "CPF? (ou 'pular')" },
  { key: "address", q: "Endereço de entrega completo (rua, número, complemento, cidade, CEP)?" },
  { key: "card_number", q: "Número do cartão — use um cartão VIRTUAL com limite baixo. (ou 'pular')" },
  { key: "card_exp", q: "Validade do cartão (MM/AA)? (ou 'pular')" },
  { key: "card_cvv", q: "CVV do cartão? (ou 'pular')" },
  { key: "card_holder", q: "Nome impresso no cartão? (ou 'pular')" },
  { key: "shirt_size", q: "Tamanho de camiseta (P/M/G/GG)? (ou 'pular')" },
  { key: "shoe_size", q: "Número do calçado? (ou 'pular')" },
  { key: "partner_name", q: "Nome de quem você costuma presentear (namorada/parceiro/familiar)? (ou 'pular')" },
  { key: "partner_tastes", q: "Gostos dessa pessoa p/ presentes? (ou 'pular')" },
];

function isSkip(s: string): boolean {
  return /^\s*(pular|skip|-)\s*$/i.test(s);
}

/** Traduz erro técnico do provedor numa mensagem CLARA + como resolver (req. do dono). */
export function clarifyError(raw: string): string {
  const s = raw.toLowerCase();
  if (/401|403|unauthorized|invalid[_ ]?(api[_ ]?key|token)|token.*expired|expired.*token|not authenticated|reauth|re-?login/.test(s))
    return "🔑 Sua sessão/credencial do provedor expirou. No terminal da máquina rode `typermagic login openai` (ou `anthropic`) e tente de novo.";
  if (/429|rate[ _]?limit|too many requests|overloaded|capacity/.test(s))
    return "⏳ Limite de uso do provedor atingido agora. Espere alguns minutos (a janela de 5h do Codex reabre sozinha) e repita o pedido.";
  if (/quota|insufficient_quota|billing|payment required|credit|out of/.test(s))
    return "💳 Os créditos/cota da API acabaram. Confira o plano/billing do provedor.";
  if (/econnrefused|enotfound|fetch failed|getaddrinfo|network|timeout|etimedout|socket hang/.test(s))
    return "🌐 Falha de rede com o provedor. Confira a internet e tente de novo.";
  return `⚠️ Deu erro: ${raw.slice(0, 200)}`;
}

export class Gateway {
  private readonly rate: RateLimiter;
  private readonly surface: `gateway:${string}`;
  private readonly pending = new PendingStore();
  /** chats com uma tarefa em andamento (evita 2 engines concorrentes no mesmo chat) */
  private readonly busy = new Set<string>();
  /** navegador e cofre compartilhados, abertos sob demanda (lazy) */
  private browser: BrowserSession | undefined;
  private vault: Vault | undefined;
  /** memória de conversa por chat (multi-turno): "quero esta opção" enxerga o que veio antes */
  private readonly history = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
  /** monitoramento: falhas seguidas (p/ alerta proativo) e última falha (p/ /status) */
  private consecutiveErrors = 0;
  private lastError = "";

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly config: GatewayConfig,
    private readonly hooks: GatewayHooks = {},
  ) {
    this.rate = new RateLimiter(config.rateCapacity ?? 5, config.rateRefillMs ?? 4000);
    this.surface = `gateway:${adapter.name}`;
  }

  private allowed(sender: string): boolean {
    return this.config.allow.includes(sender);
  }

  private grantFor(sender: string): CapabilityGrant | undefined {
    // grant explícito por remetente (config) ou undefined → default da superfície (READONLY)
    return this.config.grants?.[sender];
  }

  /** Pergunta algo ao usuário pelo canal e ESPERA a resposta (a próxima mensagem do chat).
   *  Base de aprovação, esclarecimento e OTP. Registra a pendência ANTES de enviar (assim
   *  não há corrida se a resposta chegar muito rápido). Timeout → rejeita (default-deny). */
  async askUser(chatId: string, kind: PendingKind, prompt: string): Promise<string> {
    const answer = this.pending.wait(chatId, kind, ASK_TIMEOUT_MS);
    await this.adapter.send(chatId, prompt);
    return answer;
  }

  /** Processa uma mensagem (resposta-pendente → allowlist → rate-limit → Engine). */
  async handle(msg: IncomingMessage): Promise<void> {
    const sender = msg.senderId;
    const chatId = msg.chatId;

    // 1. É a RESPOSTA a uma pergunta pendente? Só de um remetente autorizado.
    //    (a pendência só existe porque a tarefa que a criou já foi autorizada.)
    if (this.allowed(sender) && this.pending.resolve(chatId, msg.text)) return;

    // 2. Allowlist (default-deny).
    if (!this.allowed(sender)) {
      await this.adapter.send(chatId, "⛔ Remetente não autorizado.");
      this.hooks.onAudit?.({ sender, result: "denied" });
      return;
    }

    // 3. Já há uma tarefa em andamento neste chat (sem pergunta pendente)? Evita
    //    dois engines concorrentes no mesmo chat.
    if (this.busy.has(chatId)) {
      await this.adapter.send(chatId, "⏳ Ainda estou no seu pedido anterior. Aguarde eu terminar.");
      return;
    }

    // 4. Comandos do gateway (/setup, /set, /vault, ...) — escrevem no cofre DIRETO,
    //    sem passar pelo modelo (cartão/senha nunca chegam ao LLM).
    if (isCommand(msg.text)) {
      this.busy.add(chatId);
      try {
        await this.handleCommand(chatId, msg.text);
      } finally {
        this.busy.delete(chatId);
      }
      return;
    }

    // 5. Rate-limit por remetente.
    if (!this.rate.allow(sender)) {
      await this.adapter.send(chatId, "⏳ Muitas mensagens. Tente em instantes.");
      this.hooks.onAudit?.({ sender, result: "rate_limited" });
      return;
    }

    // 5. Roda a tarefa. (O loop de polling chama handle() SEM await — então enquanto esta
    //    tarefa fica suspensa esperando uma confirmação, a próxima mensagem é roteada acima.)
    this.busy.add(chatId);
    try {
      await this.runTask(msg);
    } finally {
      this.busy.delete(chatId);
    }
  }

  /** navegador compartilhado (abre na 1ª tarefa que precisa; perfil persistente). */
  private async ensureBrowser(): Promise<BrowserSession> {
    if (!this.browser) {
      // não conectamos a um Chrome externo (cdpUrl)? então é nosso perfil → limpa órfãos/lock.
      if (!this.config.browser?.cdpUrl) {
        const profile =
          this.config.browser?.profileDir ??
          process.env.TYPER_BROWSER_PROFILE ??
          join(homedir(), ".typer", "browser", "profile");
        cleanupStaleBrowser(profile);
      }
      this.browser = await openBrowser(this.config.browser ?? {});
    }
    return this.browser;
  }

  /** cofre compartilhado (abre sob demanda). */
  private async ensureVault(): Promise<Vault> {
    if (!this.vault) this.vault = await openVault();
    return this.vault;
  }

  private async runTask(msg: IncomingMessage): Promise<void> {
    const sender = msg.senderId;
    const chatId = msg.chatId;
    const grant = this.grantFor(sender);
    // super-assistente: navegador real, cofre cifrado e o canal de perguntas (ask_user).
    const browser = this.config.browser ? await this.ensureBrowser() : undefined;
    const vault = this.config.vault ? await this.ensureVault() : undefined;
    const ask = (kind: "clarify" | "otp", question: string): Promise<string> =>
      this.askUser(chatId, kind, question);
    // CONTINUIDADE: diz ao agente ONDE o navegador já está, p/ ele continuar de lá em vez de
    // recomeçar do zero a cada mensagem (senão perde o progresso da reserva/carrinho/login).
    let prompt = msg.text;
    if (browser) {
      const where = await browser.url().catch(() => "");
      if (where && !/^about:blank|^chrome:|^$/.test(where)) {
        prompt = `(O navegador JÁ está aberto em: ${where} . Se esta tarefa continua de onde paramos, NÃO recomece do zero — dê um browser_read na página atual e continue daí.)\n\n${msg.text}`;
      }
    }
    // Teto de aprovações por tarefa: corta o LOOP de "confirma de novo" quando a página
    // não finaliza (anti-bot/multi-passo) e o modelo re-clica "concluir" sem parar.
    let approvals = 0;
    const engine = createEngine(
      {
        root: this.config.root,
        surface: this.surface,
        provider: this.config.provider ?? null,
        local: this.config.local ?? false,
        mode: "ask", // canal responde; não edita o repo
        // INTERATIVO (não "never"): tira a superfície do modo autônomo, então o policy
        // gate roteia ação irreversível p/ "approve" (HITL) em vez de negar de cara.
        approval: "always",
        ...(grant ? { capabilities: grant } : {}),
        features: this.config.features ?? {},
        ...(browser ? { browser } : {}),
        ...(vault ? { vault } : {}),
        ask,
      },
      // HITL: toda aprovação vira uma pergunta no canal que ESPERA o seu SIM/NÃO.
      {
        approve: async (req) => {
          if (++approvals > MAX_APPROVALS_PER_TASK) {
            await this.adapter.send(
              chatId,
              "🛑 Pedi confirmação vezes demais nesta tarefa — a página não está finalizando (provável anti-bot/login exigido). Parei pra não te deixar num loop. Você pode concluir na janela do navegador, ou me peça pra tentar outro site/abordagem.",
            );
            return false;
          }
          return this.approveViaChannel(chatId, req);
        },
      },
    );

    let buf = "";
    let errored = false;
    let done = false;
    // se demorar (tarefa de navegador é multi-passo), avisa que está trabalhando — assim
    // não PARECE travado enquanto processa.
    const hint = setTimeout(() => {
      if (!done) {
        void this.adapter.send(chatId, "🔎 Tô trabalhando no seu pedido — pode levar 1–2 min. Te aviso quando terminar.");
      }
    }, 7000);
    (hint as { unref?: () => void }).unref?.();
    try {
      for await (const ev of engine.runTask({ prompt, history: this.history.get(chatId) ?? [] })) {
        buf = this.fold(buf, ev);
      }
      this.hooks.onAudit?.({ sender, result: "ok" });
      this.consecutiveErrors = 0; // tudo certo: zera o contador de falhas
    } catch (err) {
      errored = true;
      const message = err instanceof Error ? err.message : String(err);
      buf += `\n${clarifyError(message)}`;
      this.lastError = message;
      this.consecutiveErrors++;
      // SEGURANÇA: audita só a MENSAGEM do erro — nunca o buf (que pode conter conteúdo
      // de página/resposta). Nada de conteúdo do usuário vai pra log.
      this.hooks.onAudit?.({ sender, result: "error", detail: message });
      // ALERTA PROATIVO: várias falhas seguidas = algo estranho (sessão/cota/rede/bloqueio).
      if (this.consecutiveErrors >= 3) {
        void this.notifyOwner(`⚠️ Tive ${this.consecutiveErrors} falhas seguidas. ${clarifyError(message)}`);
        this.consecutiveErrors = 0; // evita spam; recomeça a contagem
      }
    } finally {
      done = true;
      clearTimeout(hint);
      await engine.dispose();
    }
    const reply = buf.trim() || "(sem resposta)";
    await this.adapter.send(chatId, reply);
    // só lembra de turnos que DERAM CERTO (não polui o contexto com erro/"(sem resposta)").
    if (!errored && buf.trim()) this.remember(chatId, msg.text, reply);
  }

  /** Avisa o(s) dono(s) proativamente (DM = chatId é o próprio id da allowlist). */
  private async notifyOwner(text: string): Promise<void> {
    for (const id of this.config.allow) {
      await this.adapter.send(id, text).catch(() => {});
    }
  }

  /** Guarda o turno na memória da conversa: trunca textos longos (não inflar o contexto)
   *  e mantém só as últimas ~5 trocas. */
  private remember(chatId: string, user: string, assistant: string): void {
    const trim = (s: string): string => (s.length > 1500 ? s.slice(0, 1500) + " […]" : s);
    const h = this.history.get(chatId) ?? [];
    h.push({ role: "user", content: trim(user) }, { role: "assistant", content: trim(assistant) });
    while (h.length > 10) h.shift();
    this.history.set(chatId, h);
  }

  /** Aprovação humana via canal: manda o cartão-resumo e espera SIM/NÃO. Timeout/erro
   *  → CANCELA (default-deny). Nunca aprova sozinho. */
  private async approveViaChannel(chatId: string, req: ApprovalLike): Promise<boolean> {
    let answer: string;
    try {
      answer = await this.askUser(chatId, "approval", this.formatApproval(req));
    } catch {
      await this.adapter.send(chatId, "⌛ Sem confirmação a tempo — ação CANCELADA por segurança.");
      return false;
    }
    const ok = AFFIRMATIVE.test(answer);
    await this.adapter.send(chatId, ok ? "✅ Confirmado." : "🚫 Cancelado.");
    return ok;
  }

  private formatApproval(req: ApprovalLike): string {
    const lines = ["🔐 Confirmação necessária", `• Ação: ${req.action}`, `• Alvo: ${req.target}`];
    if (req.detail) lines.push(`• Detalhe: ${req.detail}`);
    lines.push("", "Responda SIM para aprovar ou NÃO para cancelar.");
    return lines.join("\n");
  }

  private fold(buf: string, ev: EngineEvent): string {
    if (ev.type === "token") return buf + ev.text;
    if (ev.type === "policy" && ev.decision === "deny") return buf + `\n🔒 bloqueado: ${ev.reason ?? "política"}`;
    if (ev.type === "error") return buf + `\n${clarifyError(ev.message)}`;
    return buf;
  }

  /** Liga o gateway ao canal e começa a escutar. */
  async start(): Promise<void> {
    this.adapter.onMessage((m) => this.handle(m));
    await this.adapter.start();
  }

  /** Despacha um comando do gateway. Tudo escreve no cofre DIRETO — o modelo nunca vê. */
  private async handleCommand(chatId: string, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = commandOf(text);
    if (cmd === "/help") {
      await this.adapter.send(
        chatId,
        [
          "Comandos:",
          "/setup — preenche seu perfil (nome, endereço, cartão, etc.) passo a passo",
          "/set <campo> <valor> — grava um campo (ex.: /set email a@b.com)",
          "/vault — mostra o que está guardado (cartão/senha mascarados)",
          "/forget <campo> — apaga um campo",
          "/reset — zera a memória da conversa (recomeça do zero)",
          "/status — saúde do assistente (ferramentas, falhas, última falha)",
          "",
          "Fora os comandos, é só pedir em linguagem natural (ex.: 'compre uma camiseta...').",
        ].join("\n"),
      );
      return;
    }
    if (cmd === "/vault") {
      const vault = await this.ensureVault();
      const summary = vault.summary();
      const keys = Object.keys(summary);
      await this.adapter.send(
        chatId,
        keys.length
          ? "🔐 No cofre:\n" + keys.map((k) => `• ${k}: ${summary[k]}`).join("\n")
          : "Cofre vazio. Use /setup p/ preencher.",
      );
      return;
    }
    if (cmd === "/set") {
      const field = parts[1];
      const value = parts.slice(2).join(" ").trim();
      if (!field || !value) {
        await this.adapter.send(chatId, "Uso: /set <campo> <valor>  (ex.: /set email a@b.com)");
        return;
      }
      const vault = await this.ensureVault();
      await vault.set(field, value);
      await this.adapter.send(chatId, `✅ ${field} guardado.`);
      return;
    }
    if (cmd === "/forget") {
      const field = parts[1];
      if (!field) {
        await this.adapter.send(chatId, "Uso: /forget <campo>");
        return;
      }
      const vault = await this.ensureVault();
      await vault.delete(field);
      await this.adapter.send(chatId, `🗑️ ${field} apagado.`);
      return;
    }
    if (cmd === "/reset") {
      this.history.delete(chatId);
      await this.adapter.send(chatId, "🧹 Conversa zerada — recomeçamos do zero.");
      return;
    }
    if (cmd === "/status") {
      const f = this.config.features ?? {};
      await this.adapter.send(
        chatId,
        [
          "🤖 Status do assistente",
          `• Ferramentas: ${f.tools ? "on" : "off"} · Memória: ${f.memory ? "on" : "off"} · Navegador: ${this.config.browser ? "on" : "off"} · Cofre: ${this.config.vault ? "on" : "off"}`,
          `• Falhas seguidas: ${this.consecutiveErrors}`,
          `• Última falha: ${this.lastError ? clarifyError(this.lastError) : "nenhuma 👍"}`,
        ].join("\n"),
      );
      return;
    }
    if (cmd === "/setup") {
      await this.runSetup(chatId);
      return;
    }
  }

  /** Onboarding guiado: pergunta cada campo e grava no cofre (valores nunca vão ao modelo). */
  private async runSetup(chatId: string): Promise<void> {
    const vault = await this.ensureVault();
    await this.adapter.send(
      chatId,
      "Vamos preencher seu perfil (uma vez). Responda cada pergunta; mande 'pular' p/ deixar em branco. ⚠️ Use um cartão VIRTUAL com limite baixo.",
    );
    for (const { key, q } of SETUP_FIELDS) {
      let answer: string;
      try {
        answer = await this.askUser(chatId, "clarify", q);
      } catch {
        await this.adapter.send(chatId, "⌛ Setup interrompido (sem resposta). Recomece com /setup quando quiser.");
        return;
      }
      if (isSkip(answer)) continue;
      await vault.set(key, answer.trim());
    }
    const summary = vault.summary();
    await this.adapter.send(
      chatId,
      "✅ Perfil salvo (cifrado). Resumo:\n" +
        Object.keys(summary)
          .map((k) => `• ${k}: ${summary[k]}`)
          .join("\n"),
    );
  }

  stop(): void {
    this.adapter.stop();
    void this.browser?.close();
  }
}
