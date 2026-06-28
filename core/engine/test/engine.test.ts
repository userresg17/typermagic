import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../src/engine.js";
import type { Engine, EngineEvent, TaskRequest } from "../src/types.js";

// provider:"fake" força o FakeProvider offline (independe de chave no ambiente).
const host = { approve: () => true };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-engine-"));
  await mkdir(join(root, "src"), { recursive: true });
});

async function collect(engine: Engine, req: TaskRequest): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const ev of engine.runTask(req)) out.push(ev);
  return out;
}

describe("createEngine.runTask", () => {
  it("modo ask transmite tokens e termina Respondido", async () => {
    const engine = createEngine({ root, surface: "cli", provider: "fake", mode: "ask" }, host);
    const events = await collect(engine, { prompt: "o que é BYOK?" });
    expect(events.some((e) => e.type === "token")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done && done.type === "done" && done.outcome.state).toBe("Respondido");
  });

  it("modo code sem blocos SEARCH/REPLACE termina SemEdicoes (Fake não edita)", async () => {
    const engine = createEngine({ root, surface: "cli", provider: "fake", mode: "code" }, host);
    const events = await collect(engine, { prompt: "adicione tratamento de erro" });
    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.outcome.state).toBe("SemEdicoes");
  });

  it("emite o evento done mesmo quando a tarefa falha (erro não escapa do stream)", async () => {
    // verify exige testCommand; aqui exercitamos só que o stream sempre fecha com done/error
    const engine = createEngine({ root, surface: "cli", provider: "fake", mode: "ask" }, host);
    const events = await collect(engine, { prompt: "" });
    const last = events.at(-1);
    expect(last && (last.type === "done" || last.type === "error")).toBe(true);
  });
});

describe("createEngine.callTool — broker de capacidade", () => {
  it("permite read_file no terminal (grant cheio)", async () => {
    await writeFile(join(root, "hello.txt"), "olá mundo");
    const engine = createEngine({ root, surface: "cli", provider: "fake" }, host);
    const out = await engine.callTool("read_file", { path: "hello.txt" });
    expect(JSON.stringify(out)).toContain("olá");
  });

  it("NEGA write_file numa superfície de gateway (somente-leitura)", async () => {
    const engine = createEngine({ root, surface: "gateway:test", provider: "fake" }, host);
    await expect(engine.callTool("write_file", { path: "x.txt", content: "z" })).rejects.toThrow(
      /permissão/i,
    );
  });

  it("permite read_file numa superfície de gateway (leitura está no piso)", async () => {
    await writeFile(join(root, "ok.txt"), "conteúdo legível");
    const engine = createEngine({ root, surface: "gateway:test", provider: "fake" }, host);
    const out = await engine.callTool("read_file", { path: "ok.txt" });
    expect(JSON.stringify(out)).toContain("legível");
  });

  it("ferramenta desconhecida lança erro claro", async () => {
    const engine = createEngine({ root, surface: "cli", provider: "fake" }, host);
    await expect(engine.callTool("ferramenta_que_nao_existe", {})).rejects.toThrow(/desconhecida/i);
  });

  it("audit() acumula as decisões da instância", async () => {
    await writeFile(join(root, "a.txt"), "x");
    const engine = createEngine({ root, surface: "cli", provider: "fake" }, host);
    await engine.callTool("read_file", { path: "a.txt" });
    expect(engine.audit().length).toBeGreaterThan(0);
  });
});
