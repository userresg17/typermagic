import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEmbedder } from "@typer/index";
import type { SealResult } from "@typer/seal";
import { VerifiedSkillStore } from "../src/store.js";
import type { CompletedTask } from "../src/types.js";

const VERIFICADO: SealResult = {
  state: "Verificado",
  passed: true,
  output: "",
  durationMs: 1,
  applied: ["x.ts"],
};
const REJEITADO: SealResult = {
  state: "Rejeitado",
  passed: false,
  output: "boom",
  durationMs: 1,
  reverted: ["x.ts"],
  reason: "Suíte falhou (exit 1).",
};

const task = (over: Partial<CompletedTask> = {}): CompletedTask => ({
  name: "Adicionar tratamento de erro a um adaptador",
  description: "envolver chamadas de rede com try/catch e mensagem clara",
  methodology: "1. localizar a chamada fetch\n2. envolver em try/catch\n3. lançar erro com contexto",
  codeVersion: "v1",
  ...over,
});

let dir: string;
let store: VerifiedSkillStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "typer-skills-"));
  store = new VerifiedSkillStore({
    dir,
    embedder: new FakeEmbedder(),
    currentCodeVersion: "v1",
    clock: () => Date.parse("2026-06-26T12:00:00Z"),
  });
});

describe("VerifiedSkillStore", () => {
  it("induz um candidato não selado", () => {
    const s = store.induce(task());
    expect(s.sealed).toBe(false);
    expect(s.name).toContain("tratamento de erro");
  });

  it("a porta do selo: só entra se Verificado", async () => {
    const candidate = store.induce(task());
    const rejected = await store.seal(candidate, REJEITADO);
    expect(rejected).toBeNull();
    expect(store.size()).toBe(0);

    const sealed = await store.seal(candidate, VERIFICADO);
    expect(sealed!.sealed).toBe(true);
    expect(store.size()).toBe(1);
  });

  it("recupera a skill selada por similaridade da tarefa", async () => {
    await store.seal(store.induce(task()), VERIFICADO);
    await store.seal(
      store.induce(task({ name: "Formatar datas", description: "usar Intl", methodology: "Intl.DateTimeFormat" })),
      VERIFICADO,
    );
    const hits = await store.retrieve("preciso tratar erro de rede com try catch", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toContain("tratamento de erro");
  });

  it("invalida skills de versão de código diferente", async () => {
    await store.seal(store.induce(task({ codeVersion: "v1" })), VERIFICADO);
    expect((await store.retrieve("tratar erro", 5)).length).toBe(1);

    const n = store.invalidate("v2"); // o código mudou
    expect(n).toBe(1);
    expect((await store.retrieve("tratar erro", 5)).length).toBe(0);
  });

  it("persiste SKILL.md e relê no load (só seladas)", async () => {
    await store.seal(store.induce(task()), VERIFICADO);
    const reloaded = new VerifiedSkillStore({
      dir,
      embedder: new FakeEmbedder(),
      currentCodeVersion: "v1",
    });
    await reloaded.load();
    expect(reloaded.size()).toBe(1);
    const hits = await reloaded.retrieve("tratamento de erro de rede", 1);
    expect(hits[0]!.methodology).toContain("try/catch");
  });
});
