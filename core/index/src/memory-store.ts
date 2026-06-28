// core/index/memory-store.ts
// VectorStore em memória, por cosseno. Forma crua, cross-platform, sem
// dependência nativa — suficiente para o pipeline funcionar e ser testado.
// O sqlite-vec entra depois atrás desta mesma interface (ADR-007).

import { cosineSimilarity } from "./similarity.js";
import type { IndexedChunk, ScoredChunk, VectorStore } from "./types.js";

interface Entry {
  chunk: IndexedChunk;
  vector: number[];
}

export class MemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, Entry>();

  upsert(items: { chunk: IndexedChunk; vector: number[] }[]): void {
    for (const it of items) {
      this.entries.set(it.chunk.id, { chunk: it.chunk, vector: it.vector });
    }
  }

  query(vector: number[], k: number): ScoredChunk[] {
    const scored: ScoredChunk[] = [];
    for (const e of this.entries.values()) {
      scored.push({ chunk: e.chunk, score: cosineSimilarity(vector, e.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  deleteByFile(file: string): void {
    for (const [id, e] of this.entries) {
      if (e.chunk.file === file) this.entries.delete(id);
    }
  }

  size(): number {
    return this.entries.size;
  }
}
