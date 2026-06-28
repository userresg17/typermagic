// core/retrieval/types.ts
// Contrato da recuperação. No Estágio 1 só há dois sinais: o arquivo aberto e o
// grep textual por ripgrep. Os campos já preveem o crescimento para a busca
// híbrida (semântico + texto + grafo) da Fase 3, sem trocar a interface.

/** Teto de tokens que o contexto montado não pode ultrapassar. */
export interface TokenBudget {
  maxTokens: number;
}

/** Um arquivo lido inteiro do disco (o "arquivo aberto"). */
export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

/** Um trecho casado por palavra-chave via ripgrep. */
export interface Snippet {
  file: string;
  line: number;
  text: string;
}

/** Um chunk recuperado pela busca híbrida (semântico + grafo), com seu score. */
export interface RetrievedChunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  /** de onde veio o sinal dominante: semântico, grafo, ou ambos */
  source: "semantic" | "graph" | "hybrid";
}

/** O contexto montado, pronto para virar prompt. */
export interface Context {
  query: string;
  files: ContextFile[];
  /** chunks ranqueados da busca híbrida (Fase 3); ausente no retriever do E1 */
  chunks?: RetrievedChunk[];
  snippets: Snippet[];
  approxTokens: number;
}

/** A interface que a Fase 3 vai reimplementar com busca semântica. */
export interface Retriever {
  retrieve(query: string, budget: TokenBudget): Promise<Context>;
}

/** Estimativa grosseira de tokens, ~4 chars por token. Consistente com os
 *  adaptadores de provider até a contagem real entrar na subfase 2.3. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
