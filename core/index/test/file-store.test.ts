// Testes do VectorStore persistente (item 3).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileVectorStore } from "../src/file-store.js";
import type { IndexedChunk } from "../src/types.js";

function chunk(id: string, file: string): IndexedChunk {
  return { id, file, startLine: 1, endLine: 2, text: `texto ${id}` };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "typer-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileVectorStore (item 3)", () => {
  it("persiste e recarrega entries + fileHashes (round-trip)", async () => {
    const path = join(dir, "index.json");
    const s1 = new FileVectorStore(path);
    s1.upsert([{ chunk: chunk("a#1-2", "a.ts"), vector: [1, 0, 0] }]);
    s1.setFileHash("a.ts", "h1");
    await s1.save();

    const s2 = new FileVectorStore(path);
    await s2.load();
    expect(s2.size()).toBe(1);
    expect(s2.fileHash("a.ts")).toBe("h1");
    const hits = s2.query([1, 0, 0], 5);
    expect(hits[0]!.chunk.id).toBe("a#1-2");
    expect(hits[0]!.score).toBeGreaterThan(0.99);
  });

  it("isFresh: true só quando o hash bate (base do pular reindexação)", async () => {
    const s = new FileVectorStore(join(dir, "i.json"));
    s.setFileHash("a.ts", "h1");
    expect(s.isFresh("a.ts", "h1")).toBe(true);
    expect(s.isFresh("a.ts", "h2")).toBe(false);
    expect(s.isFresh("b.ts", "h1")).toBe(false);
  });

  it("deleteByFile remove chunks e o hash do arquivo", async () => {
    const s = new FileVectorStore(join(dir, "i.json"));
    s.upsert([
      { chunk: chunk("a#1-2", "a.ts"), vector: [1, 0] },
      { chunk: chunk("b#1-2", "b.ts"), vector: [0, 1] },
    ]);
    s.setFileHash("a.ts", "h");
    s.deleteByFile("a.ts");
    expect(s.size()).toBe(1);
    expect(s.fileHash("a.ts")).toBeUndefined();
  });

  it("load silencioso quando o arquivo não existe", async () => {
    const s = new FileVectorStore(join(dir, "naoexiste.json"));
    await s.load();
    expect(s.size()).toBe(0);
  });

  it("save é no-op sem mudanças (dirty tracking)", async () => {
    const path = join(dir, "i.json");
    const s = new FileVectorStore(path);
    await s.save(); // nada a salvar → não cria o arquivo
    const s2 = new FileVectorStore(path);
    await s2.load();
    expect(s2.size()).toBe(0);
  });
});
