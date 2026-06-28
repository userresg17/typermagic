// core/agent/tools/dispatch.ts
// Despacho e política (AGENT_TOOLS.md §6). Valida args contra o schema, checa
// permissão/contexto, aplica o gate de aprovação e o gate de selo, audita TODA
// chamada e devolve sempre ToolResult — a ferramenta nunca lança para o agente.
//
// Centralizamos auditoria e selo AQUI (não no handler, como nos exemplos do spec):
// um único ponto de auditoria, e o handler de escrita só PRODUZ o plano — o selo
// (injetado via ctx.seal, que aplica→testa→mantém/reverte) decide se vale.

import type { ToolResult, ToolContext, ToolParam } from "./types.js";
import { nowIso } from "./types.js";
import type { ToolRegistry } from "./registry.js";

function matchesType(v: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number";
    case "boolean":
      return typeof v === "boolean";
    case "string[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    default:
      return true; // tipos compostos (Range, Diff, Edit[], Pos, ...): aceita
  }
}

function validateArgs(
  params: ToolParam[],
  args: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  for (const p of params) {
    const has = Object.prototype.hasOwnProperty.call(args, p.name);
    if (p.required && !has) {
      return { ok: false, message: `falta o parâmetro obrigatório: ${p.name}` };
    }
    if (has && !matchesType(args[p.name], p.type)) {
      return { ok: false, message: `tipo inválido para ${p.name}: esperado ${p.type}` };
    }
  }
  return { ok: true };
}

export async function dispatch(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { ok: false, error: { code: "unknown_tool", message: `ferramenta desconhecida: ${name}` } };
  }

  const audit = (result: "ok" | "error" | "denied") =>
    ctx.audit({ tool: name, args, origin: ctx.origin, result, at: nowIso() });

  // 1. validação de args contra o schema
  const valid = validateArgs(tool.params, args);
  if (!valid.ok) {
    audit("error");
    return { ok: false, error: { code: "invalid_args", message: valid.message } };
  }

  // 2. contexto de execução: microVM exige adaptador (não há no v1 → erro honesto)
  if (tool.exec === "microvm" && !ctx.deps?.microvm) {
    audit("error");
    return {
      ok: false,
      error: { code: "microvm_unavailable", message: "microVM não disponível neste ambiente" },
    };
  }

  // 3. gate de aprovação humana (ação sensível)
  if (tool.requiresApproval) {
    const approved = await ctx.approve(`${name}: ${tool.description}`);
    if (!approved) {
      audit("denied");
      return { ok: false, error: { code: "denied", message: "aprovação negada" } };
    }
  }

  // 4. execução — handler nunca derruba o agente
  let result: ToolResult;
  try {
    result = await tool.handler(args, ctx);
  } catch (e) {
    audit("error");
    return {
      ok: false,
      error: { code: "exec_error", message: e instanceof Error ? e.message : String(e) },
    };
  }

  // 5. gate de selo: escrita do agente só vale depois da suíte passar. O handler
  //    produziu o plano em result.value; ctx.seal aplica→testa→mantém/reverte.
  if (tool.sealGated && result.ok) {
    const seal = await ctx.seal.verify(result.value);
    if (!seal.passed) {
      audit("error");
      return { ok: false, error: { code: "rejected", message: "selo: suíte falhou, mudança revertida" } };
    }
  }

  // 6. auditoria
  audit(result.ok ? "ok" : "error");
  return result;
}
