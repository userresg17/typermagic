// core/retrieval/index.ts — superfície pública do pacote @typer/retrieval

export type {
  Context,
  ContextFile,
  Snippet,
  RetrievedChunk,
  TokenBudget,
  Retriever,
} from "./types.js";
export { approxTokens } from "./types.js";
export { RipgrepRetriever } from "./retriever.js";
export type { RipgrepRetrieverOptions } from "./retriever.js";
export { HybridRetriever } from "./hybrid.js";
export type { HybridRetrieverOptions } from "./hybrid.js";
export { assembleContext, renderContext } from "./assemble.js";
export { extractTerms } from "./terms.js";
export { grep, ripgrepAvailable } from "./ripgrep.js";
export { readContextFile } from "./file-context.js";
export { buildSemanticContext, indexPath } from "./semantic-context.js";
export type { SemanticStats } from "./semantic-context.js";
export { assembleFimContext } from "./fim-context.js";
export type {
  FimSignals,
  RepoContext,
  FimBudget,
  EditTrailEntry,
  FimDiagnostic,
} from "./fim-context.js";
