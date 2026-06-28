// core/cost/pricing.ts
// Tabela de preços por modelo, em USD por milhão de tokens. Fonte: tabela de
// modelos da Anthropic (verificada via skill claude-api, jun/2026). É DADO,
// fácil de atualizar quando o preço muda — o mecanismo do medidor não depende
// destes números.

export interface ModelPrice {
  /** USD por 1M tokens de entrada */
  input: number;
  /** USD por 1M tokens de saída */
  output: number;
}

export const PRICING: Record<string, ModelPrice> = {
  // Anthropic (tabela de modelos da Anthropic, jun/2026)
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },

  // OpenAI — APROXIMADOS, confirmar em https://openai.com/api/pricing
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};

// Multiplicadores do cache de prompt, relativos ao preço de input.
export const CACHE = {
  read: 0.1, // leitura do cache custa ~0,1x
  write5m: 1.25, // escrita com TTL de 5 min
  write1h: 2.0, // escrita com TTL de 1 h
} as const;

/** Provider local: custo zero. */
export const FREE_PRICE: ModelPrice = { input: 0, output: 0 };

export function priceFor(model: string): ModelPrice {
  return PRICING[model] ?? FREE_PRICE;
}
