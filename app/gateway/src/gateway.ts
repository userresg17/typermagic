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

import { createEngine, type CapabilityGrant, type EngineEvent } from "@typer/engine";
import { openBrowser, type BrowserSession } from "@typer/agent";
import { openVault, type Vault } from "@typer/vault";
import { RateLimiter } from "./rate-limit.js";
import { PendingStore, type PendingKind } from "./pending.js";
import type { ChannelAdapter, GatewayConfig, IncomingMessage } from "./types.js";

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

/** Reconhece um "sim" (aprovação). Qualquer outra coisa = não aprovado. */
const AFFIRMATIVE = /^\s*(sim|s|yes|y|ok|confirmo|confirmar|confirmado|aprovar|aprovo|pode|manda)\b/i;

/** Comandos do gateway (escrevem no cofre direto, sem passar pelo modelo). */
const COMMANDS = ["/setup", "/set", "/vault", "/forget", "/help"];
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

export class Gateway {
  private readonly rate: RateLimiter;
  private readonly surface: `gateway:${string}`;
  private readonly pending = new PendingStore();
  /** chats com uma tarefa em andamento (evita 2 engines concorrentes no mesmo chat) */
  private readonly busy = new Set<string>();
  /** navegador e cofre compartilhados, abertos sob demanda (lazy) */
  private browser: BrowserSession | undefined;
  private vault: Vault | undefined;

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
    if (!this.browser) this.browser = await openBrowser(this.config.browser ?? {});
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
      { approve: (req) => this.approveViaChannel(chatId, req) },
    );

    let buf = "";
    try {
      for await (const ev of engine.runTask({ prompt: msg.text })) {
        buf = this.fold(buf, ev);
      }
      this.hooks.onAudit?.({ sender, result: "ok" });
    } catch (err) {
      buf += `\n[erro: ${err instanceof Error ? err.message : String(err)}]`;
      this.hooks.onAudit?.({ sender, result: "error", detail: buf });
    } finally {
      await engine.dispose();
    }
    await this.adapter.send(chatId, buf.trim() || "(sem resposta)");
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
    if (ev.type === "error") return buf + `\n[erro: ${ev.message}]`;
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
