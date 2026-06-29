// core/agent/test/tools.test.ts — registry, descoberta, despacho e política da
// camada de ferramentas (AGENT_TOOLS.md). Tudo offline, contra um ToolContext fake.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDefaultRegistry,
  dispatch,
  registryExecutor,
  reachSkillSection,
  type ToolContext,
  type AuditEvent,
} from "../src/index.js";

let ws: string;
beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "typer-tools-"));
  await writeFile(join(ws, "a.txt"), "linha1\nlinha2\nlinha3\n");
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

function fakeCtx(over: Partial<ToolContext> & { events?: AuditEvent[] } = {}): ToolContext {
  const events = over.events ?? [];
  return {
    workspace: ws,
    origin: "agent",
    approve: over.approve ?? (async () => true),
    audit: over.audit ?? ((e) => events.push(e)),
    seal: over.seal ?? { verify: async () => ({ passed: true }) },
    ...(over.deps ? { deps: over.deps } : {}),
  };
}

describe("registry e descoberta", () => {
  const registry = buildDefaultRegistry();

  it("registra exatamente 66 ferramentas", () => {
    expect(registry.all()).toHaveLength(66);
  });

  it("o core tem 19 ferramentas", () => {
    expect(registry.core()).toHaveLength(19);
  });

  it("nomes são únicos", () => {
    const names = new Set(registry.all().map((t) => t.name));
    expect(names.size).toBe(66);
  });

  it("search acha ferramenta lazy por contexto", () => {
    const hits = registry.search("renomear símbolo no projeto");
    expect(hits.map((t) => t.name)).toContain("rename_symbol");
  });

  it("search casa por nome direto", () => {
    const hits = registry.search("git_commit");
    expect(hits[0]?.name).toBe("git_commit");
  });
});

describe("despacho e contrato de erro", () => {
  const registry = buildDefaultRegistry();

  it("ferramenta desconhecida → unknown_tool", async () => {
    const r = await dispatch(registry, "naoexiste", {}, fakeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("unknown_tool");
  });

  it("falta de parâmetro obrigatório → invalid_args", async () => {
    const r = await dispatch(registry, "read_file", {}, fakeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("invalid_args");
  });

  it("tipo errado → invalid_args", async () => {
    const r = await dispatch(registry, "read_file", { path: 123 }, fakeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("invalid_args");
  });

  it("read_file (core) lê um arquivo de verdade", async () => {
    const r = await dispatch(registry, "read_file", { path: "a.txt" }, fakeCtx());
    expect(r.ok).toBe(true);
    expect(r.value).toContain("linha2");
  });

  it("read_file com range devolve só o intervalo", async () => {
    const r = await dispatch(registry, "read_file", { path: "a.txt", range: { start: 2, end: 2 } }, fakeCtx());
    expect(r.value).toBe("linha2");
  });

  it("handler nunca lança: caminho fora do workspace vira erro", async () => {
    const r = await dispatch(registry, "read_file", { path: "../../etc/passwd" }, fakeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("exec_error");
  });
});

describe("política: aprovação, selo, microVM, auditoria", () => {
  const registry = buildDefaultRegistry();

  it("run_command pede aprovação; negada → denied", async () => {
    const events: AuditEvent[] = [];
    const r = await dispatch(registry, "run_command", { cmd: "echo oi" }, fakeCtx({ approve: async () => false, events }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("denied");
    expect(events.at(-1)?.result).toBe("denied");
  });

  it("write_file é seal-gated: selo reprovado → rejected (nada vale)", async () => {
    const r = await dispatch(
      registry,
      "write_file",
      { path: "novo.txt", content: "x" },
      fakeCtx({ seal: { verify: async () => ({ passed: false }) } }),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("rejected");
  });

  it("write_file seal-gated: selo aprovado → ok, com o plano", async () => {
    const r = await dispatch(
      registry,
      "write_file",
      { path: "novo.txt", content: "x" },
      fakeCtx({ seal: { verify: async () => ({ passed: true }) } }),
    );
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.value)).toBe(true);
  });

  it("sandbox_exec sem microVM → microvm_unavailable (antes de tudo)", async () => {
    const r = await dispatch(registry, "sandbox_exec", { code: "1", lang: "js" }, fakeCtx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("microvm_unavailable");
  });

  it("sandbox_exec com microVM ainda pede aprovação; negada → denied", async () => {
    const microvm = {
      run: async () => "saida",
      snapshot: async () => "snap",
      restore: async () => {},
    };
    const r = await dispatch(
      registry,
      "sandbox_exec",
      { code: "1", lang: "js" },
      fakeCtx({ approve: async () => false, deps: { microvm } }),
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("denied");
  });

  it("sandbox_exec com microVM e aprovação → roda no adaptador", async () => {
    const microvm = {
      run: async () => "saida-da-vm",
      snapshot: async () => "snap",
      restore: async () => {},
    };
    const r = await dispatch(
      registry,
      "sandbox_exec",
      { code: "1", lang: "js" },
      fakeCtx({ approve: async () => true, deps: { microvm } }),
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe("saida-da-vm");
  });

  it("toda chamada é auditada com autor, alvo e resultado", async () => {
    const events: AuditEvent[] = [];
    await dispatch(registry, "read_file", { path: "a.txt" }, fakeCtx({ events }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tool: "read_file", origin: "agent", result: "ok" });
    expect(typeof events[0]?.at).toBe("string");
  });
});

describe("adapter registry → ToolExecutor (runToolLoop)", () => {
  const registry = buildDefaultRegistry();

  it("tools() expõe o core como ToolSpec", () => {
    const exec = registryExecutor(registry, fakeCtx());
    const specs = exec.tools();
    expect(specs).toHaveLength(19);
    expect(specs[0]).toHaveProperty("inputSchema");
    expect(specs.map((s) => s.name)).toContain("read_file");
  });

  it("call roteia pelo dispatcher e serializa o resultado", async () => {
    const exec = registryExecutor(registry, fakeCtx());
    const r = await exec.call("read_file", { path: "a.txt" });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("linha1");
  });

  it("call de ferramenta que falha → isError", async () => {
    const exec = registryExecutor(registry, fakeCtx());
    const r = await exec.call("read_file", {});
    expect(r.isError).toBe(true);
  });
});

describe("reachSkillSection (doc do reach no system prompt)", () => {
  it("injeta o REACH_SKILL quando há tool reach_* exposta", () => {
    const s = reachSkillSection([{ name: "fs_read" }, { name: "reach_search" }]);
    expect(s).toContain("olhos na internet");
    expect(s).toContain("reach_read");
  });
  it("vazio quando nenhuma tool reach está exposta", () => {
    expect(reachSkillSection([{ name: "fs_read" }, { name: "web_get" }])).toBe("");
    expect(reachSkillSection([])).toBe("");
  });
});
