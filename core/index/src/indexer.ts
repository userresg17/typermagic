// core/index/indexer.ts
// Pipeline de indexação: chunk → embed → store, mais a busca. Incremental por
// chunk (3.4): hash do texto de cada chunk; só re-embeda os que mudaram e reusa
// o vetor dos iguais. Editar uma função não re-embeda o arquivo todo.

import { createHash } from "node:crypto";
import { chunkCode, type ChunkOptions } from "./chunk.js";
import { chunkAst } from "./ast-chunk.js";
import type { Embedder, IndexedChunk, ScoredChunk, VectorStore } from "./types.js";

export interface IndexStats {
  chunks: number;
  embedded: number;
  reused: number;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class Indexer {
  // por arquivo: hash do chunk → vetor, para reusar os inalterados
  private readonly cacheByFile = new Map<string, Map<string, number[]>>();

  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly chunkOpts: ChunkOptions = {},
  ) {}

  /** Indexa (ou reindexa) um arquivo. Usa AST quando há gramática; reaproveita
   *  os vetores dos chunks cujo texto não mudou. */
  async indexFile(file: string, content: string): Promise<IndexStats> {
    const maxLines = this.chunkOpts.maxLines;
    const raw =
      (await chunkAst(content, file, maxLines !== undefined ? { maxLines } : {})) ??
      chunkCode(content, this.chunkOpts);

    if (raw.length === 0) {
      this.store.deleteByFile(file);
      this.cacheByFile.delete(file);
      return { chunks: 0, embedded: 0, reused: 0 };
    }

    const prev = this.cacheByFile.get(file) ?? new Map<string, number[]>();
    const hashes = raw.map((c) => hashText(c.text));

    // o que precisa embeddar: chunks cujo hash não está no cache do arquivo
    const toEmbedIdx: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (!prev.has(hashes[i]!)) toEmbedIdx.push(i);
    }
    const fresh = toEmbedIdx.length
      ? await this.embedder.embed(toEmbedIdx.map((i) => raw[i]!.text))
      : [];

    const next = new Map<string, number[]>();
    const entries = raw.map((c, i) => {
      const h = hashes[i]!;
      let vector = prev.get(h);
      if (!vector) {
        const pos = toEmbedIdx.indexOf(i);
        vector = fresh[pos] ?? [];
      }
      next.set(h, vector);
      const chunk: IndexedChunk = {
        id: `${file}#${c.startLine}-${c.endLine}`,
        file,
        startLine: c.startLine,
        endLine: c.endLine,
        text: c.text,
      };
      return { chunk, vector };
    });

    this.store.deleteByFile(file);
    this.store.upsert(entries);
    this.cacheByFile.set(file, next);
    return {
      chunks: entries.length,
      embedded: toEmbedIdx.length,
      reused: entries.length - toEmbedIdx.length,
    };
  }

  /** Busca os k chunks mais próximos da consulta. */
  async query(text: string, k = 5): Promise<ScoredChunk[]> {
    const [vector] = await this.embedder.embed([text]);
    if (!vector) return [];
    return this.store.query(vector, k);
  }

  removeFile(file: string): void {
    this.store.deleteByFile(file);
    this.cacheByFile.delete(file);
  }

  size(): number {
    return this.store.size();
  }
}
