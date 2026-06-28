// core/agent/tools/families/sandbox.ts → sandbox isolado (AGENT_TOOLS.md §7).
// Código não confiável roda em microVM. Não há microVM real no v1: o dispatcher
// barra exec:microvm sem adaptador (microvm_unavailable) ANTES do handler. Se um
// adaptador for injetado (ctx.deps.microvm), os handlers o usam. resource_limit é
// meta/in_process (registra limites).

import type { Tool } from "./types.js";

const sandboxExec: Tool = {
  name: "sandbox_exec",
  family: "sandbox",
  description: "Roda código não confiável numa microVM isolada.",
  params: [
    { name: "code", type: "string", required: true, description: "código" },
    { name: "lang", type: "string", required: true, description: "linguagem" },
  ],
  returns: "saída da execução",
  permission: "exec",
  exec: "microvm",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  handler: async (args, ctx) => {
    const out = await ctx.deps!.microvm!.run(args.code as string, args.lang as string);
    return { ok: true, value: out };
  },
};

const ephemeralRun: Tool = {
  name: "ephemeral_run",
  family: "sandbox",
  description: "Roda um trecho efêmero numa microVM (descartada ao fim).",
  params: [{ name: "code", type: "string", required: true, description: "código" }],
  returns: "saída",
  permission: "exec",
  exec: "microvm",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  handler: async (args, ctx) => {
    const out = await ctx.deps!.microvm!.run(args.code as string, "auto");
    return { ok: true, value: out };
  },
};

const sandboxSnapshot: Tool = {
  name: "sandbox_snapshot",
  family: "sandbox",
  description: "Tira um snapshot do estado da microVM.",
  params: [{ name: "id", type: "string", required: true, description: "id da microVM" }],
  returns: "snapshot",
  permission: "meta",
  exec: "microvm",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const snap = await ctx.deps!.microvm!.snapshot(args.id as string);
    return { ok: true, value: snap };
  },
};

const sandboxRestore: Tool = {
  name: "sandbox_restore",
  family: "sandbox",
  description: "Restaura a microVM a partir de um snapshot.",
  params: [{ name: "snapshot", type: "string", required: true, description: "snapshot" }],
  returns: "ok",
  permission: "meta",
  exec: "microvm",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    await ctx.deps!.microvm!.restore(args.snapshot as string);
    return { ok: true, value: "restaurado" };
  },
};

const resourceLimit: Tool = {
  name: "resource_limit",
  family: "sandbox",
  description: "Define limites de recurso (cpu, ram, rede) para execuções isoladas.",
  params: [
    { name: "cpu", type: "number", required: true, description: "núcleos" },
    { name: "ram", type: "number", required: true, description: "MB de RAM" },
    { name: "net", type: "boolean", required: true, description: "permite rede?" },
  ],
  returns: "limites aplicados",
  permission: "meta",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args) => ({
    ok: true,
    value: { cpu: args.cpu, ram: args.ram, net: args.net },
  }),
};

export const sandboxTools: Tool[] = [
  sandboxExec,
  ephemeralRun,
  sandboxSnapshot,
  sandboxRestore,
  resourceLimit,
];
