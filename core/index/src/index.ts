// core/index/index.ts — superfície pública do pacote @typer/index

export type {
  Embedder,
  VectorStore,
  IndexedChunk,
  ScoredChunk,
} from "./types.js";
export { cosineSimilarity } from "./similarity.js";
export { MemoryVectorStore } from "./memory-store.js";
export { FileVectorStore } from "./file-store.js";
export { chunkCode } from "./chunk.js";
export type { RawChunk, ChunkOptions } from "./chunk.js";
export { chunkAst } from "./ast-chunk.js";
export { grammarNameFor, loadLanguage, parserFor } from "./languages.js";
export { extractSymbols } from "./symbols.js";
export type { SymbolDef, FileSymbols } from "./symbols.js";
export { SymbolGraph } from "./symbol-graph.js";
export type { RelatedFile } from "./symbol-graph.js";
export { OllamaEmbedder, OpenAIEmbedder, FakeEmbedder } from "./embedders.js";
export { pickEmbedder } from "./embedder-pick.js";
export type { EmbedderChoice } from "./embedder-pick.js";
export { Indexer } from "./indexer.js";
export type { IndexStats } from "./indexer.js";
export { ReindexScheduler } from "./reindex-scheduler.js";
export type { ReindexSchedulerOptions } from "./reindex-scheduler.js";
export { watchDirectory } from "./watcher.js";
export type { Watcher, WatchOptions } from "./watcher.js";
