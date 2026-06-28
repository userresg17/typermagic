// core/memory/index.ts — superfície pública do pacote @typer/memory

export type {
  MemoryEntry,
  MemoryInput,
  MemoryKind,
  MemoryStore,
} from "./types.js";
export { MarkdownMemory } from "./store.js";
export type { MarkdownMemoryOptions } from "./store.js";
export {
  scoreMemory,
  recencyScore,
  tokenize,
  lexicalScore,
  sourceTrust,
  VERIFIED_BOOST,
  DEFAULT_WEIGHTS,
} from "./recall.js";
export type { RecallWeights, ScoreParts } from "./recall.js";
export { readAll, writeEntry } from "./vault.js";
// memória v2 — grafo estilo Obsidian
export { parseWikilinks, parseTags, slugify, resolveLink } from "./links.js";
export type { Wikilink } from "./links.js";
export { NoteGraph, titleOf } from "./graph.js";
export type { NoteGraphView, GraphNode, GraphEdge } from "./graph.js";
