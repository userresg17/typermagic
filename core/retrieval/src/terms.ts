// core/retrieval/terms.ts
// Extração de termos de busca a partir da consulta. Puro e testável. Tira
// stopwords (pt e en) e tokens curtos, para o grep não puxar lixo por "de",
// "the" e afins.

const STOPWORDS = new Set([
  // pt
  "a", "o", "os", "as", "de", "da", "do", "das", "dos", "e", "ou", "um", "uma",
  "que", "qual", "quais", "como", "para", "pra", "por", "com", "sem", "em", "no",
  "na", "nos", "nas", "se", "ao", "aos", "este", "esta", "esse", "essa", "isto",
  "isso", "meu", "minha", "seu", "sua", "me", "te", "lhe", "está", "estao",
  "função", "funcao", "arquivo", "código", "codigo",
  // en
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "without",
  "is", "are", "this", "that", "these", "those", "it", "as", "at", "by", "be",
  "what", "which", "how", "file", "function", "code",
]);

const MAX_TERMS = 6;
const MIN_LEN = 3;

/** Quebra a consulta em termos úteis para o grep. Preserva identificadores
 *  camelCase/snake_case inteiros, que costumam ser o que importa no código. */
export function extractTerms(query: string): string[] {
  const raw = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const tok of raw) {
    const lower = tok.toLowerCase();
    if (tok.length < MIN_LEN) continue;
    if (STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(tok);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}
