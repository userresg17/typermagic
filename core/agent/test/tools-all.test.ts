// core/agent/test/tools-all.test.ts
// Validação das 50 ferramentas (pedido do dono): despacha CADA UMA pelo dispatcher,
// num workspace temporário real (git init + arquivos + ripgrep), e confere o
// resultado esperado — ok onde o subsistema existe, erro GRACIOSO documentado onde
// a infra não há (LSP rico, busca web, visão). Nenhuma pode lançar.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDefaultRegistry,
  dispatch,
  type ToolContext,
  type ToolResult,
} from "../src/index.js";

let ws: string;
const registry = buildDefaultRegistry();

const A_TS = `export function soma(a: number, b: number): number {\n  return a + b;\n}\nexport const PI = 3.14;\n`;
const UTIL_TS = `import { soma } from "./a";\nexport function dobro(x: number): number {\n  return soma(x, x);\n}\n`;

beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "typer-50tools-"));
  await writeFile(join(ws, "a.ts"), A_TS);
  await writeFile(join(ws, "util.ts"), UTIL_TS);
  // repo git (p/ as ferramentas git)
  execSync(
    'git init -q && git config user.email t@t.dev && git config user.name t && git add -A && git commit -q -m init',
    { cwd: ws },
  );
  process.env.TYPER_RG_PATH = process.env.TYPER_RG_PATH ?? "rg";
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

const fakeMicroVm = {
  run: async () => "saida-vm",
  snapshot: async () => "snap-1",
  restore: async () => {},
};

function ctx(): ToolContext {
  return {
    workspace: ws,
    origin: "agent",
    approve: async () => true,
    audit: () => {},
    seal: { verify: async () => ({ passed: true }) },
    deps: {
      microvm: fakeMicroVm,
      mcp: { call: async () => ({ content: "ok" }) },
      testCommand: "true",
      local: false,
      hasOpenAI: false,
    },
  };
}

type Expect = "ok" | { err: string } | "valid"; // valid = ToolResult válido (rg/embedder/rede)

interface Spec {
  name: string;
  args: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  expect: Expect;
}

const EDIT_PATCH =
  "### FILE: a.ts\n<<<<<<< SEARCH\nexport const PI = 3.14;\n=======\nexport const PI = 3.14159;\n>>>>>>> REPLACE";

const specs: Spec[] = [
  // arquivos
  { name: "read_file", args: () => ({ path: "a.ts" }), expect: "ok" },
  { name: "write_file", args: () => ({ path: "novo.ts", content: "x" }), expect: "ok" },
  { name: "edit_diff", args: () => ({ path: "a.ts", patch: EDIT_PATCH }), expect: "ok" },
  { name: "multi_edit", args: () => ({ edits: [{ file: "a.ts", search: "export const PI = 3.14;", replace: "export const PI = 3.1;" }] }), expect: "ok" },
  { name: "list_dir", args: () => ({ path: "." }), expect: "ok" },
  // busca (dependem de rg/embedder → valid)
  { name: "semantic_search", args: () => ({ query: "soma" }), expect: "valid" },
  { name: "grep_search", args: () => ({ pattern: "soma" }), expect: "valid" },
  { name: "symbol_graph_query", args: () => ({ symbol: "soma" }), expect: "valid" },
  { name: "find_files", args: () => ({ glob: "*.ts" }), expect: "ok" },
  { name: "retrieve_context", args: () => ({ query: "soma" }), expect: "valid" },
  // terminal
  { name: "run_command", args: () => ({ cmd: "echo oi" }), expect: "ok" },
  { name: "run_background", args: () => ({ cmd: "echo bg" }), expect: "ok" },
  {
    name: "read_terminal",
    args: async () => {
      const r = (await dispatch(registry, "run_background", { cmd: "echo hi" }, ctx())) as ToolResult;
      return { handle: (r.value as { handle: string }).handle };
    },
    expect: "ok",
  },
  {
    name: "kill_process",
    args: async () => {
      const r = (await dispatch(registry, "run_background", { cmd: "sleep 5" }, ctx())) as ToolResult;
      return { handle: (r.value as { handle: string }).handle };
    },
    expect: "ok",
  },
  { name: "env_inspect", args: () => ({ keys: ["PATH"] }), expect: "ok" },
  // git
  { name: "git_status", args: () => ({}), expect: "ok" },
  { name: "git_diff", args: () => ({}), expect: "ok" },
  {
    name: "git_commit",
    args: async () => {
      await writeFile(join(ws, "commitme.ts"), "export const z = 1;\n");
      return { message: "chore: teste" };
    },
    expect: "ok",
  },
  { name: "git_branch", args: () => ({ op: "list" }), expect: "ok" },
  { name: "git_blame", args: () => ({ path: "a.ts" }), expect: "ok" },
  // teste/selo
  { name: "run_tests", args: () => ({}), expect: "ok" },
  { name: "run_test_file", args: () => ({ path: "x" }), expect: "ok" },
  { name: "seal_change", args: () => ({ diff: [] }), expect: "ok" },
  { name: "coverage_report", args: () => ({}), expect: "ok" },
  { name: "diagnostics", args: () => ({}), expect: "ok" },
  // memória/skills/handoff
  { name: "memory_write", args: () => ({ entry: { text: "lembrar disso" } }), expect: "ok" },
  { name: "memory_recall", args: () => ({ query: "lembrar" }), expect: "ok" },
  { name: "skill_induce", args: () => ({ task: { name: "t", description: "d", methodology: "m", codeVersion: "1" } }), expect: "ok" },
  { name: "skill_invoke", args: () => ({ task: "fazer x" }), expect: "ok" },
  { name: "handoff_emit", args: () => ({ section: "S", goal: "g" }), expect: "ok" },
  // orquestração
  { name: "plan_todo", args: () => ({ op: "add", items: ["passo 1"] }), expect: "ok" },
  { name: "request_approval", args: () => ({ reason: "fazer algo" }), expect: "ok" },
  { name: "spawn_subagent", args: () => ({ task: "t" }), expect: { err: "not_wired" } },
  { name: "use_mcp_tool", args: () => ({ server: "s", tool: "t", args: {} }), expect: "ok" },
  { name: "package_manage", args: () => ({ op: "bogus" }), expect: { err: "bad_op" } },
  // lsp
  { name: "document_symbols", args: () => ({ path: "a.ts" }), expect: "ok" },
  { name: "goto_definition", args: () => ({ symbol: "soma" }), expect: "valid" },
  { name: "find_references", args: () => ({ symbol: "soma" }), expect: "valid" },
  { name: "hover_info", args: () => ({ symbol: "soma", at: {} }), expect: { err: "needs_lsp" } },
  { name: "rename_symbol", args: () => ({ symbol: "soma", at: {}, name: "sum" }), expect: { err: "needs_lsp" } },
  // sandbox (microVM fake injetado)
  { name: "sandbox_exec", args: () => ({ code: "1", lang: "js" }), expect: "ok" },
  { name: "ephemeral_run", args: () => ({ code: "1" }), expect: "ok" },
  { name: "sandbox_snapshot", args: () => ({ id: "v1" }), expect: "ok" },
  { name: "sandbox_restore", args: () => ({ snapshot: "s1" }), expect: "ok" },
  { name: "resource_limit", args: () => ({ cpu: 1, ram: 512, net: false }), expect: "ok" },
  // web
  { name: "web_fetch", args: () => ({ url: "ftp://invalido" }), expect: { err: "bad_url" } },
  { name: "web_search", args: () => ({ query: "q" }), expect: { err: "no_search_provider" } },
  { name: "docs_lookup", args: () => ({ lib: "l", query: "q" }), expect: { err: "not_configured" } },
  { name: "browser_action", args: () => ({ action: {} }), expect: "ok" },
  { name: "image_read", args: () => ({ path: "x.png" }), expect: { err: "needs_vision" } },
];

describe("cobertura: todas as 50 ferramentas estão no spec", () => {
  it("o spec cobre exatamente as 50 do registry", () => {
    const registered = new Set(registry.all().map((t) => t.name));
    const tested = new Set(specs.map((s) => s.name));
    expect(specs).toHaveLength(50);
    expect(registered.size).toBe(50);
    for (const n of registered) expect(tested.has(n)).toBe(true);
  });
});

describe("validação 1-a-1 das 50 ferramentas", () => {
  for (const spec of specs) {
    const label =
      spec.expect === "ok" ? "→ ok" : spec.expect === "valid" ? "→ resultado válido" : `→ erro ${spec.expect.err}`;
    it(`${spec.name} ${label}`, async () => {
      const args = await spec.args();
      const r = await dispatch(registry, spec.name, args, ctx());
      // contrato universal: sempre ToolResult, nunca lança
      expect(typeof r.ok).toBe("boolean");
      if (spec.expect === "ok") {
        expect(r.ok, `erro: ${r.error?.code} ${r.error?.message}`).toBe(true);
      } else if (spec.expect === "valid") {
        // pode ser ok ou erro gracioso (depende de rg/embedder/rede), mas válido
        if (!r.ok) expect(typeof r.error?.code).toBe("string");
      } else {
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe(spec.expect.err);
      }
    });
  }
});
