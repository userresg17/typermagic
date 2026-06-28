// core/agent/tools/families/testseal.ts → teste e selo (AGENT_TOOLS.md §7).
// run_tests reusa @typer/seal/runTests; seal_change é o PORTÃO (ctx.seal). O
// comando de teste vem do contexto (ctx.deps.testCommand). diagnostics/coverage
// são best-effort headless.

import { runTests } from "@typer/seal";
import type { Tool } from "./types.js";
import { runSubprocess } from "./executors.js";

const runTestsTool: Tool = {
  name: "run_tests",
  family: "teste",
  description: "Roda a suíte de testes do projeto (filtro opcional).",
  params: [{ name: "filter", type: "string", required: false, description: "filtro de teste" }],
  returns: "{passed, code, output}",
  permission: "exec",
  exec: "subprocess",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const base = ctx.deps?.testCommand;
    if (!base) return { ok: false, error: { code: "no_test_command", message: "testCommand não configurado" } };
    const cmd = args.filter ? `${base} ${args.filter as string}` : base;
    const r = await runTests(ctx.workspace, cmd);
    return { ok: r.code === 0, value: { passed: r.code === 0, code: r.code, output: r.output, timedOut: r.timedOut } };
  },
};

const runTestFile: Tool = {
  name: "run_test_file",
  family: "teste",
  description: "Roda um arquivo de teste específico.",
  params: [{ name: "path", type: "string", required: true, description: "arquivo de teste" }],
  returns: "{passed, code, output}",
  permission: "exec",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const base = ctx.deps?.testCommand;
    if (!base) return { ok: false, error: { code: "no_test_command", message: "testCommand não configurado" } };
    const r = await runTests(ctx.workspace, `${base} ${args.path as string}`);
    return { ok: r.code === 0, value: { passed: r.code === 0, code: r.code, output: r.output, timedOut: r.timedOut } };
  },
};

const sealChange: Tool = {
  name: "seal_change",
  family: "selo",
  description: "Submete uma mudança ao selo. Rejeitado até a suíte passar.",
  params: [{ name: "diff", type: "Diff", required: true, description: "FilePlan[] ou diff a verificar" }],
  returns: "selado ou rejeitado",
  permission: "exec",
  exec: "subprocess",
  tier: "core",
  requiresApproval: false,
  sealGated: false, // o próprio selo; não se auto-gateia
  handler: async (args, ctx) => {
    const seal = await ctx.seal.verify(args.diff);
    return seal.passed
      ? { ok: true, value: "verificado" }
      : { ok: false, error: { code: "rejected", message: "rejeitado: suíte falhou" } };
  },
};

const coverageReport: Tool = {
  name: "coverage_report",
  family: "teste",
  description: "Relatório de cobertura (best-effort: roda o testCommand com cobertura).",
  params: [],
  returns: "saída de cobertura",
  permission: "exec",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (_args, ctx) => {
    const base = ctx.deps?.testCommand;
    if (!base) return { ok: false, error: { code: "no_test_command", message: "testCommand não configurado" } };
    const r = await runSubprocess(`${base} --coverage`, { cwd: ctx.workspace });
    return { ok: r.code === 0, value: r.stdout || r.stderr };
  },
};

const diagnostics: Tool = {
  name: "diagnostics",
  family: "teste",
  description: "Erros de tipo/lint perto de um arquivo (headless: limitado).",
  params: [{ name: "path", type: "string", required: false, description: "arquivo (opcional)" }],
  returns: "[{message,line,severity}]",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async () => {
    // headless não tem o LSP do editor; devolve vazio com nota (não quebra fluxos).
    return { ok: true, value: { diagnostics: [], note: "diagnostics ricos vêm do LSP do editor (indisponível headless)" } };
  },
};

export const testSealTools: Tool[] = [
  runTestsTool,
  runTestFile,
  sealChange,
  coverageReport,
  diagnostics,
];
