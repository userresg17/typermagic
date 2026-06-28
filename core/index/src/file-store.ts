// core/index/file-store.ts
// VectorStore PERSISTENTE (item 3) — mesma interface do MemoryVectorStore, mas com
// load()/save() num arquivo JSON. Guarda os chunks+vetores e um hash por arquivo,
// para o chamador PULAR a reindexação de arquivos inalterados entre runs (não
// re-embeda o repo todo). Sem dependência nativa; o sqlite-vec entra depois atrás
// desta mesma interface (ADR-007).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { cosineSimilarity } from "./similarity.js";
import type { IndexedChunk, ScoredChunk, VectorStore } from "./types.js";

interface Entry {
  chunk: IndexedChunk;
  vector: number[];
}

interface Persisted {
  version: number;
  entries: Entry[];
  fileHashes: [string, string][];
}

const VERSION = 1;

export class FileVectorStore implements VectorStore {
  private readonly entries = new Map<string, Entry>();
  private readonly fileHashes = new Map<string, string>();
  private dirty = false;

  constructor(private readonly path: string) {}

  /** Carrega do disco; silencioso se o arquivo não existe/é inválido. */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return;
    }
    try {
      const data = JSON.parse(raw) as Persisted;
      if (data.version !== VERSION) return; // formato antigo: ignora (reindexa)
      for (const e of data.entries) this.entries.set(e.chunk.id, e);
      for (const [f, h] of data.fileHashes) this.fileHashes.set(f, h);
    } catch {
      /* JSON corrompido: começa vazio */
    }
  }

  /** Persiste no disco (cria o diretório). Só escreve se houve mudança. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    const data: Persisted = {
      version: VERSION,
      entries: [...this.entries.values()],
      fileHashes: [...this.fileHashes.entries()],
    };
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(data), "utf8");
    this.dirty = false;
  }

  upsert(items: { chunk: IndexedChunk; vector: number[] }[]): void {
    for (const it of items) {
      this.entries.set(it.chunk.id, { chunk: it.chunk, vector: it.vector });
    }
    if (items.length) this.dirty = true;
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
    if (this.fileHashes.delete(file)) this.dirty = true;
  }

  size(): number {
    return this.entries.size;
  }

  // ===== persistência incremental por arquivo =====

  /** Hash de conteúdo registrado p/ um arquivo (ou undefined se nunca indexado). */
  fileHash(file: string): string | undefined {
    return this.fileHashes.get(file);
  }

  /** Registra o hash de conteúdo de um arquivo recém-indexado. */
  setFileHash(file: string, hash: string): void {
    this.fileHashes.set(file, hash);
    this.dirty = true;
  }

  /** true se o arquivo já está indexado com este mesmo hash (pode pular). */
  isFresh(file: string, hash: string): boolean {
    return this.fileHashes.get(file) === hash;
  }
}
