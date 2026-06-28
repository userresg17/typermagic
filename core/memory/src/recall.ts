// core/memory/recall.ts
// Score de recuperação na linha dos Generative Agents: mistura de recência,
// importância e relevância. A memória v2 acrescenta dois sinais — texto (overlap
// léxico) e grafo (proximidade no grafo de links) — e a procedência: verificado e
// fonte confiável desempatam (aplicados no store, fora deste núcleo puro). A
// confiança modula o total, então a recuperação prefere o que é confiável. Puro e
// testável (recebe `now`).

export interface RecallWeights {
  recency: number;
  importance: number;
  relevance: number;
  /** overlap léxico query↔nota (v2) */
  text?: number;
  /** proximidade no grafo de links a partir dos hits semânticos (v2) */
  graph?: number;
}

export const DEFAULT_WEIGHTS: RecallWeights = {
  recency: 1,
  importance: 1,
  relevance: 2,
  text: 1,
  graph: 1,
};

/** Empurrão p/ entradas verificadas pelo selo (aplicado no store, não aqui). */
export const VERIFIED_BOOST = 1.15;

/** Confiança da procedência: selo/handoff/usuário/ADR > consolidação > agente. */
export function sourceTrust(source: string): number {
  if (source === "seal" || source === "handoff" || source === "user" || source === "adr") {
    return 1.1;
  }
  if (source === "consolidation") return 1.05;
  return 1;
}

const HOUR_MS = 3_600_000;

/** Decaimento por meia-vida: 1 agora, 0.5 após halfLifeHours. */
export function recencyScore(atMs: number, nowMs: number, halfLifeHours = 24): number {
  const hours = Math.max(0, (nowMs - atMs) / HOUR_MS);
  return Math.pow(0.5, hours / halfLifeHours);
}

/** Tokeniza p/ overlap léxico (minúsculas, só letras/números/_). */
export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** Fração dos termos da query presentes no texto ou nas tags da nota (0..1). */
export function lexicalScore(queryTerms: string[], text: string, tags: string[] = []): number {
  if (queryTerms.length === 0) return 0;
  const hay = new Set<string>([...tokenize(text), ...tags.map((t) => t.toLowerCase())]);
  let hits = 0;
  for (const t of queryTerms) if (hay.has(t)) hits++;
  return hits / queryTerms.length;
}

export interface ScoreParts {
  recency: number; // 0..1
  importance: number; // 0..1
  relevance: number; // 0..1
  confidence: number; // 0..1
  text?: number; // 0..1 (v2)
  graph?: number; // 0..1 (v2)
}

/** Combina os sinais num score. A confiança modula (0.5..1), nunca zera. Os pesos
 *  text/graph são opcionais (compat com chamadas v1 que só passam os 3 sinais). */
export function scoreMemory(p: ScoreParts, w: RecallWeights = DEFAULT_WEIGHTS): number {
  const base =
    w.recency * p.recency +
    w.importance * p.importance +
    w.relevance * p.relevance +
    (w.text ?? 0) * (p.text ?? 0) +
    (w.graph ?? 0) * (p.graph ?? 0);
  return base * (0.5 + 0.5 * p.confidence);
}
