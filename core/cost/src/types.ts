// core/cost/types.ts
// Tipos do medidor: uso de token e custo por requisição.

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** tokens lidos do cache de prompt (cobrados a ~0,1x) */
  cacheReadTokens?: number;
  /** tokens escritos no cache de prompt */
  cacheWriteTokens?: number;
}

export interface Cost {
  input: number;
  output: number;
  cache: number;
  total: number; // em USD
}

export interface LedgerEntry {
  provider: string;
  model: string;
  task?: string;
  usage: Usage;
  cost: Cost;
}
