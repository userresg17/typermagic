// core/agent/desktop/agent.ts
// SUB-AGENTE DE DESKTOP: loop perceber→agir sobre a Platform (macOS/Linux). Percepção: app em
// foco + árvore AX (quando há) + screenshot lógico. Decisão: LLM devolve JSON de ações. Guardas:
// allowlist de apps, HITL p/ irreversível (finalize + rótulos perigosos + atalhos de envio/apagar),
// kill switch (signal/arquivo), handoff humano, checkpoints de screenshot e log JSONL por passo.

import type { AxTree, DesktopSession } from "../platform/types.js";
import { appAllowed, allowedApps, isStopRequested, checkSpend, parseAmountBRL, recordSpend } from "../guard.js";
import { logStep, sha256 } from "../steplog.js";
import { desktopPrompt } from "./prompt.js";

type Msg = { role: "user" | "assistant"; content: string; images?: string[] };
export type LlmChat = (system: string, messages: Msg[]) => Promise<string>;

export interface DesktopAction {
  action: string;
  name?: string;
  id?: number;
  value?: string;
  /** ação AX p/ ax_act: "Press" (default) | "SetValue" (com value) | "Confirm" | "Increment" | "ShowMenu" */
  ax?: string;
  text?: string;
  combo?: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  dy?: number;
  seconds?: number;
  question?: string;
  kind?: string;
  reason?: string;
  summary?: string;
  amount?: string | number;
  recipient?: string;
  address?: string;
  success?: boolean;
}

export interface ApprovalCard {
  action: string;
  amount?: string;
  recipient?: string;
  address?: string;
  app?: string;
}

export interface DesktopAgentDeps {
  platform: DesktopSession;
  llm: LlmChat;
  /** confirmação humana (cartão estruturado) p/ ação irreversível */
  approve?: (card: ApprovalCard) => Promise<boolean>;
  ask?: (kind: "clarify" | "otp", question: string) => Promise<string>;
  handoff?: (reason: string, pngBase64?: string) => Promise<"ok" | "cancelar">;
  checkpoint?: (pngBase64: string, caption: string) => Promise<void>;
  signal?: AbortSignal;
  maxSteps?: number;
  /** a cada quantos passos manda screenshot de checkpoint (default 5; marcos sempre vão) */
  checkpointEvery?: number;
  surface?: string;
  taskLabel?: string;
  onStep?: (info: { step: number; app: string; actions: DesktopAction[]; describe: string; thinking?: string }) => void;
}

// rótulos de nó/ação que representam efeito irreversível → exige finalize (HITL)
const IRREVERSIBLE =
  /(^|\b)(send|enviar|envia|submit|delete|apagar|excluir|remover|remove|empty trash|esvaziar|pay|pagar|pagamento|purchase|comprar|buy|confirm|confirmar|publish|publicar|post|postar|accept|aceitar|agree|concordo|reply all|responder a todos|move to trash|mover para o lixo|transferir|transfer|sign|assinar)(\b|$)/i;
// atalhos que disparam envio/apagar em apps nativos
const DANGEROUS_KEYS = /^(cmd|command|meta)\+(shift\+)?(return|enter|delete|backspace|d)$/i;

function parsePlan(raw: string): { thinking?: string; actions: DesktopAction[] } | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as { thinking?: string; actions?: DesktopAction[] };
    if (!Array.isArray(o.actions)) return null;
    return { actions: o.actions, ...(o.thinking !== undefined ? { thinking: o.thinking } : {}) };
  } catch {
    return null;
  }
}

export function serializeAx(tree: AxTree | null, max = 120): string {
  if (!tree) return "(árvore de acessibilidade indisponível — use o screenshot)";
  const lines = tree.nodes.slice(0, max).map((n) => {
    const pos = n.pos ? ` @${n.pos[0]},${n.pos[1]}` : "";
    const acts = n.actions.length ? ` {${n.actions.join("/")}}` : "";
    const val = n.value ? ` ="${n.value}"` : "";
    return `${"  ".repeat(Math.min(n.depth, 6))}[${n.id}] ${n.role}${n.label ? ` "${n.label}"` : ""}${val}${pos}${acts}${n.enabled ? "" : " (desabilitado)"}`;
  });
  const more = tree.nodes.length > max ? `\n… +${tree.nodes.length - max} nós` : tree.truncated ? "\n… (árvore truncada)" : "";
  return lines.join("\n") + more;
}

function trim(messages: Msg[], keep = 14): void {
  if (messages.length > keep) messages.splice(1, messages.length - keep);
}

interface StepCtx {
  app: string;
  tree: AxTree | null;
  shot: string;
  pendingApproval: ApprovalCard | null;
}

export async function runDesktopAgent(goal: string, deps: DesktopAgentDeps): Promise<string> {
  const p = deps.platform;
  const maxSteps = deps.maxSteps ?? 30;
  const every = deps.checkpointEvery ?? 5;
  const surface = deps.surface ?? "desktop";
  const task = deps.taskLabel ?? goal.slice(0, 80);
  const size = await p.get_screen_size();
  const system = desktopPrompt(size.width, size.height, allowedApps());
  const messages: Msg[] = [{ role: "user", content: `OBJETIVO: ${goal}` }];
  let approvedCard: ApprovalCard | null = null; // finalize aprovado → próxima ação irreversível passa
  let denials = 0;
  const seen = new Set<string>();
  let stuck = 0;

  const perceive = async (): Promise<StepCtx> => {
    const app = (await p.frontmost_app?.().catch(() => null))?.name ?? "";
    const tree = p.ax_tree ? await p.ax_tree().catch(() => null) : null;
    let shot = "";
    try {
      shot = (await p.screenshot()).png_base64;
    } catch (e) {
      console.error(`[desktop] screenshot falhou: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { app, tree, shot, pendingApproval: null };
  };

  const guardApp = (ctx: StepCtx): string | null => {
    if (ctx.app && !appAllowed(ctx.app)) {
      return `BLOQUEADO: o app em foco "${ctx.app}" não está na allowlist (${allowedApps().join(", ") || "vazia"}). Use focus_app num app permitido.`;
    }
    return null;
  };

  const needsApproval = async (label: string, ctx: StepCtx, extra: Partial<ApprovalCard> = {}): Promise<string | null> => {
    if (approvedCard) {
      approvedCard = null; // consome a aprovação: UMA ação irreversível por confirmação
      return null;
    }
    const card: ApprovalCard = { action: `${label} (em ${ctx.app || "app"})`, app: ctx.app, ...extra };
    const ok = deps.approve ? await deps.approve(card) : false;
    if (!ok) {
      denials++;
      return `BLOQUEADO: "${label}" é irreversível e o usuário NÃO confirmou. Não repita; use done explicando.`;
    }
    return null;
  };

  const exec = async (a: DesktopAction, ctx: StepCtx): Promise<{ result: string; terminal: boolean; doneText?: string }> => {
    // trava de foco: o sidecar só posta mouse/teclado se ESTE app ainda estiver na frente
    if ("expectApp" in p) p.expectApp = ctx.app;
    try {
      switch (a.action) {
        case "open_app": {
          const name = String(a.name ?? "");
          if (!appAllowed(name)) return { result: `BLOQUEADO: app "${name}" fora da allowlist (${allowedApps().join(", ")})`, terminal: false };
          if (!p.open_app) return { result: "ERRO: plataforma sem open_app", terminal: false };
          await p.open_app(name);
          await new Promise((r) => setTimeout(r, 1200));
          if (p.focus_app) await p.focus_app(name).catch(() => {});
          if ("expectApp" in p) p.expectApp = name;
          return { result: `abri ${name}`, terminal: true };
        }
        case "focus_app": {
          const name = String(a.name ?? "");
          if (!appAllowed(name)) return { result: `BLOQUEADO: app "${name}" fora da allowlist`, terminal: false };
          if (!p.focus_app) return { result: "ERRO: plataforma sem focus_app", terminal: false };
          await p.focus_app(name);
          await new Promise((r) => setTimeout(r, 500));
          if ("expectApp" in p) p.expectApp = name;
          return { result: `foquei ${name}`, terminal: true };
        }
        case "ax_act": {
          const g = guardApp(ctx);
          if (g) return { result: g, terminal: false };
          if (!p.ax_act) return { result: "ERRO: sem acessibilidade nesta plataforma", terminal: false };
          const node = ctx.tree?.nodes.find((n) => n.id === Number(a.id));
          const label = node ? `${node.role} "${node.label}"` : `nó ${a.id}`;
          // nome da ação AX: `ax` ("Press", "Confirm", "Increment"…); com `value` é SetValue.
          const axAction = a.value !== undefined ? "SetValue" : String(a.ax ?? "Press");
          if (axAction !== "SetValue" && node && IRREVERSIBLE.test(node.label)) {
            const block = await needsApproval(`Acionar ${label}`, ctx);
            if (block) return { result: block, terminal: true };
          }
          await p.ax_act(Number(a.id), axAction, a.value !== undefined ? String(a.value) : undefined);
          return { result: `${axAction} em ${label}`, terminal: axAction !== "SetValue" };
        }
        case "click":
        case "double_click":
        case "right_click": {
          const g = guardApp(ctx);
          if (g) return { result: g, terminal: false };
          const x = Number(a.x);
          const y = Number(a.y);
          // clique em cima de um nó AX com rótulo perigoso também exige HITL
          const hit = ctx.tree?.nodes.find((n) => n.pos && n.size && x >= n.pos[0] && x <= n.pos[0] + n.size[0] && y >= n.pos[1] && y <= n.pos[1] + n.size[1] && IRREVERSIBLE.test(n.label));
          if (hit) {
            const block = await needsApproval(`Clicar em ${hit.role} "${hit.label}"`, ctx);
            if (block) return { result: block, terminal: true };
          }
          if (a.action === "double_click") await p.double_click(x, y);
          else await p.click(x, y, a.action === "right_click" ? "right" : "left");
          return { result: `${a.action} em (${x},${y})`, terminal: true };
        }
        case "type": {
          const g = guardApp(ctx);
          if (g) return { result: g, terminal: false };
          await p.type(String(a.text ?? ""));
          return { result: `digitei ${String(a.text ?? "").length} caracteres`, terminal: false };
        }
        case "key": {
          const g = guardApp(ctx);
          if (g) return { result: g, terminal: false };
          const combo = String(a.combo ?? "");
          if (DANGEROUS_KEYS.test(combo.replace(/\s/g, ""))) {
            const block = await needsApproval(`Atalho ${combo}`, ctx);
            if (block) return { result: block, terminal: true };
          }
          await p.key(combo);
          return { result: `tecla ${combo}`, terminal: true };
        }
        case "scroll": {
          const g = guardApp(ctx);
          if (g) return { result: g, terminal: false };
          await p.scroll(Number(a.x ?? size.width / 2), Number(a.y ?? size.height / 2), Number(a.dy ?? -400));
          return { result: "rolei", terminal: false };
        }
        case "drag": {
          const g = guardApp(ctx);
          if (g) return { result: g, terminal: false };
          await p.drag(Number(a.x1), Number(a.y1), Number(a.x2), Number(a.y2));
          return { result: `arrastei (${a.x1},${a.y1})→(${a.x2},${a.y2})`, terminal: true };
        }
        case "wait": {
          await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(a.seconds ?? 1), 0.2), 5) * 1000));
          return { result: "esperei", terminal: true };
        }
        case "ask_user": {
          if (!deps.ask) return { result: "ERRO: canal de pergunta indisponível", terminal: true };
          const ans = await deps.ask(a.kind === "otp" ? "otp" : "clarify", String(a.question ?? ""));
          return { result: `usuário respondeu: ${ans}`, terminal: true };
        }
        case "handoff": {
          if (!deps.handoff) return { result: "ERRO: handoff indisponível neste canal", terminal: true };
          const ans = await deps.handoff(String(a.reason ?? "preciso de ajuda humana"), ctx.shot || undefined);
          if (ans === "cancelar") return { result: "handoff: usuário CANCELOU a tarefa", terminal: true, doneText: "Tarefa cancelada por você no handoff." };
          return { result: "handoff: usuário resolveu e mandou continuar (ok)", terminal: true };
        }
        case "finalize": {
          const amount = parseAmountBRL(a.amount);
          const card: ApprovalCard = {
            action: String(a.summary ?? "concluir a ação"),
            app: ctx.app,
            ...(a.amount !== undefined ? { amount: String(a.amount) } : {}),
            ...(a.recipient ? { recipient: String(a.recipient) } : {}),
            ...(a.address ? { address: String(a.address) } : {}),
          };
          if (a.amount !== undefined) {
            const v = checkSpend(amount);
            if (!v.ok) {
              denials++;
              return { result: `BLOQUEADO pelo limite de gasto: ${v.reason}`, terminal: true };
            }
          }
          if (ctx.shot && deps.checkpoint) await deps.checkpoint(ctx.shot, `📸 antes de confirmar: ${card.action.slice(0, 200)}`).catch(() => {});
          const ok = deps.approve ? await deps.approve(card) : false;
          if (!ok) {
            denials++;
            return { result: "BLOQUEADO: usuário NÃO confirmou. Não tente de novo; use done explicando.", terminal: true };
          }
          if (amount !== null && a.amount !== undefined) recordSpend(amount);
          approvedCard = card;
          return { result: "APROVADO pelo usuário — execute AGORA a ação final (ax_act/key/click) no próximo passo.", terminal: true };
        }
        case "done":
          return { result: "done", terminal: true, doneText: String(a.text ?? "Concluído.") };
        default:
          return { result: `ação desconhecida: ${a.action}`, terminal: false };
      }
    } catch (e) {
      return { result: `ERRO em ${a.action}: ${(e as Error).message}`, terminal: false };
    }
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (isStopRequested(deps.signal)) return "⛔ Parado pelo kill switch (/parar ou arquivo STOP).";
    const ctx = await perceive();
    if (step === 1 || step % every === 0) {
      if (ctx.shot && deps.checkpoint) await deps.checkpoint(ctx.shot, `📸 passo ${step} · ${ctx.app}`).catch(() => {});
    }
    for (const m of messages) delete m.images;
    const stateMsg: Msg = {
      role: "user",
      content: `[Passo ${step}/${maxSteps}] APP EM FOCO: ${ctx.app || "(nenhum)"}${ctx.app && !appAllowed(ctx.app) ? " (FORA da allowlist — use focus_app)" : ""}\n\nÁRVORE DE ACESSIBILIDADE:\n${serializeAx(ctx.tree)}\n\n${ctx.shot ? `A IMAGEM é a tela atual (${size.width}x${size.height}).` : "(sem screenshot — Screen Recording não concedido; use só a árvore)"} Responda com o JSON das próximas ações.`,
    };
    if (ctx.shot) stateMsg.images = [ctx.shot];
    messages.push(stateMsg);
    trim(messages);

    let raw: string;
    try {
      raw = await deps.llm(system, messages);
    } catch (e) {
      return `Erro ao decidir a ação no desktop: ${(e as Error).message}`;
    }
    messages.push({ role: "assistant", content: raw });
    const plan = parsePlan(raw);
    if (!plan || !plan.actions.length) {
      messages.push({ role: "user", content: 'Resposta inválida. Responda SÓ com o JSON {"actions":[...]}.' });
      continue;
    }
    const describe = plan.actions.map((a) => `${a.action}${a.id !== undefined ? `[${a.id}]` : ""}${a.name ? `"${a.name}"` : a.combo ? `"${a.combo}"` : ""}`).join(" ");
    deps.onStep?.({ step, app: ctx.app, actions: plan.actions, describe, ...(plan.thinking !== undefined ? { thinking: plan.thinking } : {}) });

    const sig = ctx.app + "|" + plan.actions.map((a) => `${a.action}:${a.id ?? a.combo ?? a.x ?? ""}`).join(",");
    stuck = seen.has(sig) ? stuck + 1 : 0;
    seen.add(sig);

    const results: string[] = [];
    for (const a of plan.actions.slice(0, 4)) {
      if (isStopRequested(deps.signal)) return "⛔ Parado pelo kill switch (/parar ou arquivo STOP).";
      const r = await exec(a, ctx);
      results.push(`${a.action}: ${r.result}`);
      logStep({
        surface, task, agent: "desktop", step, action: a.action,
        target: a.name ?? a.combo ?? (a.id !== undefined ? `ax:${a.id}` : a.x !== undefined ? `${a.x},${a.y}` : a.summary ?? ""),
        ...(ctx.shot ? { screenshot_sha256: sha256(ctx.shot) } : {}),
        result: r.result.slice(0, 200),
      });
      if (r.doneText !== undefined) {
        if (ctx.shot && deps.checkpoint) await deps.checkpoint(ctx.shot, "📸 estado final").catch(() => {});
        return r.doneText;
      }
      if (r.terminal) break;
    }
    messages.push({ role: "user", content: "Resultado das ações:\n" + results.join("\n") });
    if (denials >= 2) return "Não concluí porque a ação irreversível não foi confirmada. Deixei tudo pronto até o passo final.";
    if (stuck >= 3) {
      messages.push({ role: "user", content: "Você repetiu a MESMA ação 3x sem resultado. Tente outro caminho (atalho, menu, nó AX diferente) ou use handoff." });
      seen.clear();
      stuck = 0;
    }
  }
  return "Atingi o limite de passos sem concluir. Me diga se continuo ou ajusto algo.";
}
