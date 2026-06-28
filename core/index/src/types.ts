// core/index/types.ts
// Contratos do índice. Embeddings e vector store são interfaces — o produto é
// multi-LLM (ADR-006/007), então nada aqui depende de um fornecedor específico.

/** Gera embeddings. Provider-agnóstico: Ollama, OpenAI, ou o que registrarem. */
export interface Embedder {
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Um chunk indexável de código (ou memória, ou skill — namespaces). */
export interface IndexedChunk {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ScoredChunk {
  chunk: IndexedChunk;
  score: number;
}

/** Armazena vetores e busca por similaridade. Memória agora, sqlite-vec depois. */
export interface VectorStore {
  upsert(entries: { chunk: IndexedChunk; vector: number[] }[]): void;
  query(vector: number[], k: number): ScoredChunk[];
  /** remove todos os chunks de um arquivo — base da indexação incremental */
  deleteByFile(file: string): void;
  size(): number;
}
