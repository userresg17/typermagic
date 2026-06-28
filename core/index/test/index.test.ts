import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../src/similarity.js";
import { chunkCode } from "../src/chunk.js";
import { MemoryVectorStore } from "../src/memory-store.js";
import { FakeEmbedder } from "../src/embedders.js";
import { Indexer } from "../src/indexer.js";

describe("cosineSimilarity", () => {
  it("vale 1 para vetores iguais e 0 para ortogonais", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("retorna 0 para vetor nulo", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("chunkCode", () => {
  it("quebra por janela com sobreposição", () => {
    const content = Array.from({ length: 130 }, (_, i) => `linha ${i}`).join("\n");
    const chunks = chunkCode(content, { maxLines: 60, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(60);
    // sobreposição: o 2º começa antes do fim do 1º
    expect(chunks[1]!.startLine).toBeLessThan(chunks[0]!.endLine);
  });
  it("ignora conteúdo vazio", () => {
    expect(chunkCode("   \n  \n")).toEqual([]);
  });
});

describe("MemoryVectorStore", () => {
  it("upsert, query por cosseno e deleteByFile", () => {
    const store = new MemoryVectorStore();
    const c = (id: string, file: string): { id: string; file: string; startLine: number; endLine: number; text: string } => ({
      id,
      file,
      startLine: 1,
      endLine: 1,
      text: id,
    });
    store.upsert([
      { chunk: c("a", "x.ts"), vector: [1, 0, 0] },
      { chunk: c("b", "y.ts"), vector: [0, 1, 0] },
    ]);
    expect(store.size()).toBe(2);
    const top = store.query([0.9, 0.1, 0], 1);
    expect(top[0]!.chunk.id).toBe("a");
    store.deleteByFile("x.ts");
    expect(store.size()).toBe(1);
  });
});

describe("Indexer", () => {
  it("indexa, busca por similaridade e reindexa sem duplicar", async () => {
    const idx = new Indexer(new FakeEmbedder(), new MemoryVectorStore(), {
      maxLines: 5,
      overlap: 1,
    });
    await idx.indexFile(
      "calc.ts",
      "export function soma(a, b) { return a + b; }\nexport function media(a, b) { return (a + b) / 2; }",
    );
    await idx.indexFile("util.ts", "export const PI = 3.14;\nexport const E = 2.71;");
    expect(idx.size()).toBeGreaterThan(0);

    const hits = await idx.query("function soma a b", 3);
    expect(hits.length).toBeGreaterThan(0);
    // o chunk com "soma" deve ranquear acima do de constantes
    expect(hits[0]!.chunk.text).toContain("soma");

    // reindexar o mesmo arquivo não acumula chunks órfãos
    const before = idx.size();
    await idx.indexFile("calc.ts", "export function soma(a, b) { return a + b; }");
    expect(idx.size()).toBeLessThanOrEqual(before);
  });
});
