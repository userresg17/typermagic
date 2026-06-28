// core/agent/tools/families/orchestration.ts → orquestração, MCP e ambiente
// (AGENT_TOOLS.md §7). plan_todo e request_approval são core; spawn_subagent,
// use_mcp_tool e package_manage são lazy e pedem aprovação onde têm efeito.

import type { Tool } from "./types.js";
import { runSubprocess } from "./executors.js";

interface TodoItem {
  text: string;
  done: boolean;
}
// plano em memória, por workspace (meta do agente)
const plans = new Map<string, TodoItem[]>();

const planTodo: Tool = {
  name: "plan_todo",
  family: "orquestração",
  description: "Gerencia o plano em passos: add | list | complete | clear.",
  params: [
    { name: "op", type: "string", required: true, description: "add|list|complete|clear" },
    { name: "items", type: "string[]", required: false, description: "itens (add) ou índices completados" },
  ],
  returns: "lista atual",
  permission: "meta",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const list = plans.get(ctx.workspace) ?? [];
    const op = args.op as string;
    if (op === "add") {
      for (const t of (args.items as string[]) ?? []) list.push({ text: t, done: false });
    } else if (op === "complete") {
      for (const t of (args.items as string[]) ?? []) {
        const it = list.find((x) => x.text === t) ?? list[Number(t)];
        if (it) it.done = true;
      }
    } else if (op === "clear") {
      list.length = 0;
    } else if (op !== "list") {
      return { ok: false, error: { code: "bad_op", message: `op inválida: ${op}` } };
    }
    plans.set(ctx.workspace, list);
    return { ok: true, value: list };
  },
};

const requestApproval: Tool = {
  name: "request_approval",
  family: "orquestração",
  description: "Pede confirmação humana para uma ação.",
  params: [{ name: "reason", type: "string", required: true, description: "o que será feito" }],
  returns: "aprovado ou negado",
  permission: "meta",
  exec: "in_process",
  tier: "core",
  requiresApproval: false, // ele PRÓPRIO é o pedido
  sealGated: false,
  handler: async (args, ctx) => {
    const approved = await ctx.approve(args.reason as string);
    return { ok: true, value: { approved } };
  },
};

const spawnSubagent: Tool = {
  name: "spawn_subagent",
  family: "orquestração",
  description: "Roda um subagente num escopo isolado (requer provider configurado).",
  params: [
    { name: "task", type: "string", required: true, description: "tarefa do subagente" },
    { name: "scope", type: "Scope", required: false, description: "escopo/limites" },
  ],
  returns: "resultado do subagente",
  permission: "meta",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async () => {
    // v1: o sub-loop precisa de provider+modelo, que não estão no ToolContext base.
    // A orquestração de subagentes é exposta pela camada do app (CLI/editor).
    return {
      ok: false,
      error: { code: "not_wired", message: "spawn_subagent é orquestrado pela camada do app no v1" },
    };
  },
};

const useMcpTool: Tool = {
  name: "use_mcp_tool",
  family: "orquestração",
  description: "Chama uma ferramenta de um servidor MCP conectado.",
  params: [
    { name: "server", type: "string", required: true, description: "nome do servidor" },
    { name: "tool", type: "string", required: true, description: "nome da ferramenta" },
    { name: "args", type: "object", required: false, description: "argumentos" },
  ],
  returns: "resultado da ferramenta MCP",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  handler: async (args, ctx) => {
    if (!ctx.deps?.mcp) return { ok: false, error: { code: "no_mcp", message: "nenhum registry MCP no contexto" } };
    const qualified = `${args.server as string}.${args.tool as string}`;
    const result = await ctx.deps.mcp.call(qualified, (args.args as Record<string, unknown>) ?? {});
    return { ok: true, value: result };
  },
};

const packageManage: Tool = {
  name: "package_manage",
  family: "orquestração",
  description: "Gerencia dependências (pnpm): add | remove | update.",
  params: [
    { name: "op", type: "string", required: true, description: "add|remove|update" },
    { name: "pkg", type: "string", required: false, description: "pacote" },
  ],
  returns: "saída (com gate de licença a cargo do CI)",
  permission: "write",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  handler: async (args, ctx) => {
    const op = args.op as string;
    const pkg = args.pkg ? ` ${args.pkg as string}` : "";
    const cmd =
      op === "add"
        ? `pnpm add${pkg}`
        : op === "remove"
          ? `pnpm remove${pkg}`
          : op === "update"
            ? `pnpm update${pkg}`
            : null;
    if (!cmd) return { ok: false, error: { code: "bad_op", message: `op inválida: ${op}` } };
    const r = await runSubprocess(cmd, { cwd: ctx.workspace });
    return { ok: r.code === 0, value: r.stdout || r.stderr, ...(r.code !== 0 ? { error: { code: "pkg", message: r.stderr } } : {}) };
  },
};

export const orchestrationTools: Tool[] = [
  planTodo,
  requestApproval,
  spawnSubagent,
  useMcpTool,
  packageManage,
];
