import { describe, it, expect, beforeEach } from "vitest";
import { Indexer, MemoryVectorStore, FakeEmbedder, SymbolGraph } from "@typer/index";
import { HybridRetriever } from "../src/hybrid.js";

let indexer: Indexer;

beforeEach(async () => {
  indexer = new Indexer(new FakeEmbedder(), new MemoryVectorStore(), {
    maxLines: 4,
  });
  await indexer.indexFile(
    "auth.ts",
    "export function login(user, senha) {\n  return validarSenha(user, senha);\n}",
  );
  await indexer.indexFile(
    "math.ts",
    "export function soma(a, b) {\n  return a + b;\n}\nexport function media(xs) {\n  return soma(xs) / xs.length;\n}",
  );
});

describe("HybridRetriever", () => {
  it("recupera chunks relevantes à consulta (sinal semântico)", async () => {
    const r = new HybridRetriever({ root: process.cwd(), indexer });
    const ctx = await r.retrieve("login senha do usuário", { maxTokens: 4000 });
    expect(ctx.chunks!.length).toBeGreaterThan(0);
    expect(ctx.chunks![0]!.text).toContain("login");
    expect(ctx.chunks![0]!.source).toBe("semantic");
  });

  it("respeita o orçamento de tokens (poda)", async () => {
    const r = new HybridRetriever({ root: process.cwd(), indexer });
    const ctx = await r.retrieve("soma media login senha", { maxTokens: 20 });
    expect(ctx.approxTokens).toBeLessThanOrEqual(20);
  });

  it("dá boost por proximidade no grafo (sinal híbrido)", async () => {
    const graph = new SymbolGraph();
    // o arquivo aberto (math.ts) referencia algo definido em auth.ts
    graph.addFile("math.ts", { defs: [], refs: ["login"] });
    graph.addFile("auth.ts", {
      defs: [{ name: "login", file: "auth.ts", line: 1, kind: "function_declaration" }],
      refs: [],
    });

    const r = new HybridRetriever({
      root: process.cwd(),
      indexer,
      graph,
      files: [], // sem ler arquivo do disco; usamos math.ts como semente
    });
    // semente do grafo: passamos math.ts como "aberto" via files seria lido do
    // disco; aqui validamos a marcação de fonte quando há boost.
    const withSeed = new HybridRetriever({
      root: process.cwd(),
      indexer,
      graph,
      files: ["math.ts"],
    });
    const ctx = await withSeed.retrieve("login", { maxTokens: 4000 });
    const authChunk = ctx.chunks!.find((c) => c.file === "auth.ts");
    // auth.ts é vizinho de math.ts no grafo -> marcado como híbrido
    expect(authChunk?.source).toBe("hybrid");
    expect(r).toBeDefined();
  });
});
