// core/engine/tools.ts
// Execução de uma das 50 ferramentas pelo registry, com o broker de capacidade
// aplicado ANTES do dispatch. É o ponto onde a espinha de segurança encosta na
// camada de ferramentas: o dispatch já tem o gate de aprovação/selo/auditoria
// (AGENT_TOOLS.md §6); o broker acrescenta o menor privilégio por superfície.

import {
  buildDefaultRegistry,
  dispatch,
  toolSpec,
  nowIso,
  type Tool,
  type ToolContext,
  type ToolResult,
  type ToolDeps,
  type ToolExecutor,
  type AuditEvent,
  type MicroVm,
} from "@typer/agent";
import type { Embedder } from "@typer/index";
import { brokerAllows } from "./capability.js";
import { evaluateExternal, type Policy } from "./policy.js";
import type { CapabilityGrant, SurfaceId } from "./types.js";
import type { SealRouter } from "./seal-router.js";

/** Decisão do policy gate, reportada à superfície (vira EngineEvent). */
export interface PolicyNotice {
  decision: "allow" | "approve" | "deny";
  tool: string;
  reason?: string;
  preview?: string;
}

export interface ToolCallDeps {
  root: string;
  grant: CapabilityGrant;
  sealRouter: SealRouter;
  origin: "user" | "agent";
  approve: (reason: string) => Promise<boolean>;
  audit: (e: AuditEvent) => void;
  // espinha de segurança de efeito externo (F1)
  surface: SurfaceId;
  policy: Policy;
  /** superfície sem humano p/ aprovar — ação irreversível é negada, não executada */
  autonomous: boolean;
  /** reporta a decisão do policy gate à superfície (vira EngineEvent) */
  onPolicy?: (n: PolicyNotice) => void;
  embedder?: Embedder | undefined;
  local?: boolean;
  hasOpenAI?: boolean;
  testCommand?: string | undefined;
  /** sandbox de isolamento p/ ferramentas exec:microvm (código não confiável) */
  microvm?: MicroVm | undefined;
  /** navegador real (Playwright) p/ as ferramentas browser_* */
  browser?: ToolDeps["browser"];
  /** cofre cifrado p/ vault_fill */
  vault?: ToolDeps["vault"];
  /** pergunta ao usuário pelo canal (ask_user: esclarecimento/OTP) */
  ask?: ToolDeps["ask"];
  /** caller de LLM p/ o sub-agente de navegador (browser_task) — injetado pós provider */
  llm?: ToolDeps["llm"];
}

/** Executa uma ferramenta com o broker à frente. Nunca lança: devolve ToolResult
 *  (capability_denied quando a superfície não tem o direito). */
export async function callRegistryTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolCallDeps,
): Promise<ToolResult> {
  const registry = buildDefaultRegistry();
  const tool = registry.get(name);
  if (!tool) {
    return { ok: false, error: { code: "unknown_tool", message: `ferramenta desconhecida: ${name}` } };
  }

  // Broker de capacidade: a superfície tem o direito de usar esta ferramenta?
  const verdict = brokerAllows(tool, deps.grant);
  if (!verdict.allowed) {
    deps.audit({ tool: name, args, origin: deps.origin, result: "denied", at: nowIso() });
    return { ok: false, error: { code: "capability_denied", message: verdict.reason ?? "negado pelo broker" } };
  }

  // Policy gate de efeito externo (F1): irreversível em superfície autônoma é negado;
  // reversível fora da política escala/nega; reversível em política passa. A decisão
  // aqui SUBSTITUI o requiresApproval do dispatch p/ ferramentas externas (sem prompt duplo).
  let externalApproved = false;
  if (tool.effect?.external) {
    const v = evaluateExternal({
      toolName: name,
      effect: tool.effect,
      args,
      autonomous: deps.autonomous,
      policy: deps.policy,
    });
    deps.onPolicy?.({
      decision: v.decision,
      tool: name,
      ...("reason" in v ? { reason: v.reason } : {}),
      ...("preview" in v && v.preview !== undefined ? { preview: v.preview } : {}),
    });
    if (v.decision === "deny") {
      deps.audit({ tool: name, args, origin: deps.origin, result: "denied", at: nowIso() });
      return { ok: false, error: { code: "policy_denied", message: v.reason } };
    }
    if (v.decision === "approve") {
      const ok = await deps.approve(v.reason);
      if (!ok) {
        deps.audit({ tool: name, args, origin: deps.origin, result: "denied", at: nowIso() });
        return { ok: false, error: { code: "policy_denied", message: `aprovação negada: ${v.reason}` } };
      }
    }
    externalApproved = true; // política tratou a aprovação; o dispatch não re-pergunta
  }

  const toolDeps: ToolDeps = {
    ...(deps.embedder !== undefined ? { embedder: deps.embedder } : {}),
    ...(deps.local !== undefined ? { local: deps.local } : {}),
    ...(deps.hasOpenAI !== undefined ? { hasOpenAI: deps.hasOpenAI } : {}),
    ...(deps.testCommand !== undefined ? { testCommand: deps.testCommand } : {}),
    ...(deps.microvm !== undefined ? { microvm: deps.microvm } : {}),
    ...(deps.browser !== undefined ? { browser: deps.browser } : {}),
    ...(deps.vault !== undefined ? { vault: deps.vault } : {}),
    ...(deps.ask !== undefined ? { ask: deps.ask } : {}),
    ...(deps.llm !== undefined ? { llm: deps.llm } : {}),
  };

  const ctx: ToolContext = {
    workspace: deps.root,
    origin: deps.origin,
    // efeito externo já passou pelo policy gate → não re-pergunta no dispatch
    approve: externalApproved ? async () => true : deps.approve,
    audit: deps.audit,
    seal: deps.sealRouter.toolVerifier(),
    deps: toolDeps,
  };

  return dispatch(registry, name, args, ctx);
}

/** Executor das ferramentas para o loop de agente, com broker + policy gate + selo
 *  aplicados em cada chamada (via callRegistryTool). Expõe TODAS por padrão — incluindo
 *  as lazy (reach/web/browser/lsp): sem a descoberta lazy implementada, expor só o core
 *  deixava o agente cego p/ internet ("não tenho acesso a busca"). Cada tool é gateada
 *  na chamada, então expor a lista completa é seguro. */
export function engineToolExecutor(deps: ToolCallDeps, opts: { expose?: Tool[] } = {}): ToolExecutor {
  const registry = buildDefaultRegistry();
  const exposed = opts.expose ?? registry.all();
  return {
    tools: () => exposed.map(toolSpec),
    call: async (name, args) => {
      const r = await callRegistryTool(name, args, deps);
      if (r.ok) {
        return { content: typeof r.value === "string" ? r.value : JSON.stringify(r.value) };
      }
      return { content: r.error?.message ?? "erro desconhecido", isError: true };
    },
  };
}
