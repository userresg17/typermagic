// core/agent/browser/agent.ts
// SUB-AGENTE de navegador (estilo browser-use): loop perceber→agir. A cada passo lê a tela
// (elementos numerados), pede ao LLM um JSON de ações, executa por ÍNDICE, re-percebe, até
// done / limite. Saída em JSON (não tool-use) p/ histórico enxuto e multi-ação. Só-texto.

import type { BrowserSession, PageState } from "../tools/types.js";
import { serializeState } from "./dom.js";
import { BROWSER_AGENT_PROMPT } from "./prompt.js";

/** Mensagem simples do loop (sem acoplar o Message do router). */
type Msg = { role: "user" | "assistant"; content: string };

/** Chama o LLM (system + mensagens) e devolve o texto cru (esperado: um JSON). */
export type LlmChat = (system: string, messages: Msg[]) => Promise<string>;

export interface BrowserAgentDeps {
  session: BrowserSession;
  llm: LlmChat;
  /** confirmação humana p/ a ação final irreversível (pay/submit). */
  approve?: (reason: string) => Promise<boolean>;
  /** cofre: digita segredo por índice sem o valor passar pelo modelo. */
  vault?: { get(field: string): string | undefined; has(field: string): boolean; fields(): string[] };
  /** pergunta ao usuário (esclarecimento / OTP do banco). */
  ask?: (kind: "clarify" | "otp", question: string) => Promise<string>;
  maxSteps?: number;
  /** observabilidade (trace perceber→agir). describe = ações com rótulo do alvo. */
  onStep?: (info: {
    step: number;
    url: string;
    nElements: number;
    actions: Action[];
    describe: string;
    thinking?: string;
  }) => void;
}

export interface Action {
  action: string;
  index?: number;
  text?: string;
  field?: string;
  url?: string;
  keys?: string;
  question?: string;
  kind?: string;
  summary?: string;
  success?: boolean;
  down?: boolean;
  pages?: number;
}

/** Extrai o objeto JSON da resposta do modelo (tolerante a fences/prosa em volta). */
function parsePlan(raw: string): { thinking?: string; actions: Action[] } | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as { thinking?: string; actions?: Action[] };
    if (!Array.isArray(o.actions)) return null;
    return { actions: o.actions, ...(o.thinking !== undefined ? { thinking: o.thinking } : {}) };
  } catch {
    return null;
  }
}

// Rótulos de botão que representam ação IRREVERSÍVEL (pagar/finalizar pedido). Qualquer CLIQUE
// num elemento assim — não só a ação "finalize" — exige confirmação humana (HITL). Senão o
// modelo, negado no finalize, simplesmente clicaria no mesmo botão via "click" (bypass).
const IRREVERSIBLE =
  /(pagar|pague|pay\s*now|finaliz|finish|place\s*order|submit\s*order|confirmar\s*(pedido|compra|pagamento|order|payment)|fazer\s*pedido|comprar\s*agora|buy\s*now|postar|publicar|tweetar|tweet|\bpost\b|comentar|enviar)/i;

function elText(state: PageState, idx: number): string {
  return state.elements.find((e) => e.idx === idx)?.text ?? "";
}

async function execAction(
  a: Action,
  deps: BrowserAgentDeps,
  state: PageState,
): Promise<{ result: string; terminal: boolean; doneText?: string; denied?: boolean }> {
  const s = deps.session;
  const idx = Number(a.index);
  try {
    switch (a.action) {
      case "click": {
        const label = elText(state, idx);
        if (IRREVERSIBLE.test(label)) {
          // botão irreversível disfarçado de clique comum → exige HITL (igual ao finalize)
          const ok = deps.approve ? await deps.approve(`Clicar em "${label}" (ação IRREVERSÍVEL) em ${state.url}`) : false;
          if (!ok)
            return {
              result: `BLOQUEADO: "${label}" é irreversível e o usuário NÃO confirmou. NÃO clique de novo nele; faça done explicando que aguarda a confirmação.`,
              terminal: true,
              denied: true,
            };
        }
        await s.actByIndex(idx, "click");
        return { result: `cliquei [${idx}]`, terminal: true };
      }
      case "input":
        await s.actByIndex(idx, "type", String(a.text ?? ""));
        return { result: `digitei em [${idx}]`, terminal: false };
      case "select":
        await s.actByIndex(idx, "select", String(a.text ?? ""));
        return { result: `selecionei "${a.text}" em [${idx}]`, terminal: true };
      case "vault_fill": {
        const field = String(a.field ?? "");
        if (!deps.vault?.has(field)) return { result: `ERRO: campo "${field}" não está no cofre`, terminal: false };
        await s.fillByIndex(idx, deps.vault.get(field)!);
        return { result: `preenchi [${idx}] com "${field}" do cofre (valor oculto)`, terminal: false };
      }
      case "scroll":
        await s.scroll(a.down !== false, Number(a.pages ?? 1));
        return { result: `rolei a página`, terminal: false };
      case "navigate":
        await s.goto(String(a.url ?? ""));
        return { result: `naveguei p/ ${a.url}`, terminal: true };
      case "send_keys":
        await s.sendKeys(String(a.keys ?? ""));
        return { result: `tecla ${a.keys}`, terminal: true };
      case "ask_user": {
        if (!deps.ask) return { result: "ERRO: canal de pergunta indisponível", terminal: true };
        const ans = await deps.ask(a.kind === "otp" ? "otp" : "clarify", String(a.question ?? ""));
        return { result: `usuário respondeu: ${ans}`, terminal: true };
      }
      case "finalize": {
        const summary = String(a.summary || elText(state, idx) || "concluir a ação");
        const ok = deps.approve ? await deps.approve(summary) : false;
        if (!ok)
          return {
            result: "BLOQUEADO: usuário NÃO confirmou. NÃO tente de novo; faça done explicando que aguarda a confirmação.",
            terminal: true,
            denied: true,
          };
        await s.actByIndex(idx, "click");
        return { result: `FINALIZEI [${idx}] (aprovado pelo usuário)`, terminal: true };
      }
      case "done":
        return { result: "done", terminal: true, doneText: String(a.text ?? "Concluído.") };
      default:
        return { result: `ação desconhecida: ${a.action}`, terminal: false };
    }
  } catch (e) {
    return { result: `ERRO em ${a.action}[${idx}]: ${(e as Error).message}`, terminal: false };
  }
}

function trim(messages: Msg[], keep = 16): void {
  if (messages.length > keep) messages.splice(1, messages.length - keep); // mantém o objetivo (0)
}

/** Roda o sub-agente até concluir o objetivo. Devolve o texto do done. */
export async function runBrowserAgent(goal: string, deps: BrowserAgentDeps): Promise<string> {
  const maxSteps = deps.maxSteps ?? 40;
  // Diz ao agente QUAIS campos existem no cofre (só os NOMES — o valor nunca aparece p/ ele),
  // p/ ele usar vault_fill com o nome EXATO (ex.: amazon_login/amazon_password) em vez de chutar.
  const fields = deps.vault?.fields() ?? [];
  const vaultHint = fields.length
    ? `\n\nCAMPOS NO COFRE (use vault_fill com o NOME EXATO; o valor é digitado direto, nunca aparece p/ você): ${fields.join(", ")}.`
    : "";
  const messages: Msg[] = [{ role: "user", content: `OBJETIVO: ${goal}${vaultHint}` }];
  const seen = new Set<string>();
  let stuck = 0;
  let denials = 0;

  for (let step = 1; step <= maxSteps; step++) {
    let state;
    try {
      state = await deps.session.state();
    } catch {
      state = { url: "", title: "", text: "", elements: [] };
    }
    messages.push({ role: "user", content: `[Passo ${step}/${maxSteps}]\n${serializeState(state)}\n\nResponda com o JSON da(s) próxima(s) ação(ões).` });
    trim(messages);

    let raw: string;
    try {
      raw = await deps.llm(BROWSER_AGENT_PROMPT, messages);
    } catch (e) {
      return `Erro ao decidir a ação no navegador: ${(e as Error).message}`;
    }
    messages.push({ role: "assistant", content: raw });

    const plan = parsePlan(raw);
    if (!plan || !plan.actions.length) {
      messages.push({ role: "user", content: 'Resposta inválida. Responda SÓ com o JSON {"actions":[...]} usando as ferramentas.' });
      continue;
    }
    const describe = plan.actions
      .map((a) => {
        const lbl = a.index !== undefined ? elText(state, a.index).slice(0, 28) : a.url || a.keys || a.field || a.question || "";
        return `${a.action}${a.index !== undefined ? `[${a.index}]` : ""}${lbl ? `"${lbl}"` : ""}`;
      })
      .join(" ");
    deps.onStep?.({
      step,
      url: state.url,
      nElements: state.elements.length,
      actions: plan.actions,
      describe,
      ...(plan.thinking !== undefined ? { thinking: plan.thinking } : {}),
    });

    const sig = state.url + "|" + plan.actions.map((a) => `${a.action}:${a.index ?? ""}`).join(",");
    stuck = seen.has(sig) ? stuck + 1 : 0;
    seen.add(sig);

    const results: string[] = [];
    for (const a of plan.actions.slice(0, 5)) {
      const r = await execAction(a, deps, state);
      results.push(`${a.action}${a.index !== undefined ? `[${a.index}]` : ""}: ${r.result}`);
      if (r.denied) denials++;
      if (r.doneText !== undefined) return r.doneText;
      if (r.terminal) break;
    }
    messages.push({ role: "user", content: "Resultado das ações:\n" + results.join("\n") });

    // o usuário negou a ação irreversível 2x → para (não fica re-tentando clicar em pagar).
    if (denials >= 2) {
      return "Não finalizei porque você não confirmou a ação (pagar/enviar). Deixei tudo preenchido até o passo final — é só confirmar quando quiser que eu concluo.";
    }

    if (stuck >= 3) {
      messages.push({
        role: "user",
        content:
          "Você repetiu a MESMA ação 3x sem mudar a página. NÃO é necessariamente CAPTCHA. Tente algo DIFERENTE: role até o elemento (scroll), clique no LINK/NOME direto do item (não no card), ou em outro elemento da lista. Só fale em CAPTCHA se vir 'não sou robô' no texto da página.",
      });
      seen.clear();
      stuck = 0;
    }
  }
  return "Atingi o limite de passos no navegador sem concluir. Me diga se continuo ou ajusto algo.";
}
