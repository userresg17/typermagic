// core/handoff/canary.ts
// Canário de idioma: asserção pós-step barata que pega o drift de idioma antes
// de virar hábito. Compara o idioma da resposta com o locale do Tier 0; se
// diverge, o agente re-injeta o Tier 0 e regenera (não conta como turno).

import type { Handoff } from "./handoff.schema.js";

const PT_WORDS = new Set([
  "não", "você", "então", "código", "arquivo", "função", "está", "são",
  "com", "para", "uma", "isso", "já", "também", "só", "porque", "fazer",
  "agora", "mais", "como", "que",
]);
const EN_WORDS = new Set([
  "the", "and", "is", "are", "you", "this", "with", "for", "not", "function",
  "file", "code", "because", "now", "more", "how", "that", "what", "should",
]);

/** Detector leve de locale: pt-BR vs en, por diacríticos e palavras comuns. */
export function detectLocale(text: string): string {
  const lower = text.toLowerCase();
  let pt = /[áàâãéêíóôõúç]/.test(lower) ? 2 : 0;
  let en = 0;
  for (const w of lower.split(/[^a-zà-ú]+/)) {
    if (PT_WORDS.has(w)) pt++;
    if (EN_WORDS.has(w)) en++;
  }
  return pt >= en ? "pt-BR" : "en";
}

/** false dispara a re-injeção do Tier 0 e a regeneração da resposta. */
export function languageCanary(responseText: string, h: Handoff): boolean {
  if (!responseText.trim()) return true; // nada a checar
  const want = h.tier0.locale;
  const got = detectLocale(responseText);
  // só comparamos pt-BR vs en; outros locales passam (detector não cobre)
  if (want !== "pt-BR" && want !== "en") return true;
  return got === want;
}
