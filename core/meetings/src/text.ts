// core/meetings/text.ts — utilidades de texto puras (sem IO): normalização sem acento,
// slug p/ nome de arquivo, tokenização p/ busca lexical, detecção da palavra "reunião",
// data local em ISO com fuso e fatiamento p/ tradução por blocos.

/** minúsculas, sem acentos, só [a-z0-9 ] */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(s: string, max = 48): string {
  const slug = normalize(s).replace(/\s/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (slug || "reuniao").slice(0, max).replace(/-$/, "");
}

const STOP = new Set(
  "a o as os um uma uns umas de do da dos das em no na nos nas e ou que com por para pra pro sem sob sobre ao aos à às se não nao sim foi ser é e the of and to in on at is are was were for with that this".split(" "),
);

/** tokens úteis p/ busca (≥2 chars, sem stopwords) */
export function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** A mensagem encaminhada é uma reunião? Regra (documentada em docs/CENTRAL-REUNIOES.md):
 *  contém "reunião"/"reuniao"/"reuniões" E parece conteúdo (≥ 250 chars ou ≥ 4 linhas), ou
 *  começa explicitamente com "reunião:". Pergunta curta terminando em "?" NÃO entra — assim
 *  "o que ficou da reunião de ontem?" continua sendo pergunta pro agente. */
export function isMeetingForward(text: string, opts: { hasDocument?: boolean } = {}): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("/")) return false;
  const n = normalize(t);
  const hasWord = /\breunia?o(es)?\b/.test(n) || /\breunioes\b/.test(n);
  if (!hasWord) return false;
  if (/^reuni[aã]o\s*[:\-–—]/i.test(t)) return true;
  if (opts.hasDocument) return true;
  if (/\?\s*$/.test(t)) return false;
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).length;
  return t.length >= 250 || lines >= 4;
}

/** 1ª linha curta vira título; senão null. Tira prefixo "reunião:" se houver. */
export function titleFromText(text: string): string | null {
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return null;
  const cleaned = first.replace(/^reuni[aã]o\s*[:\-–—]\s*/i, "").replace(/^[#*\s]+/, "").trim();
  if (!cleaned || cleaned.length > 90) return null;
  if (/^reuni[aã]o$/i.test(cleaned)) return null;
  return cleaned;
}

/** ISO local com offset (2026-10-11T14:30:00-03:00) — o arquivo mostra a hora de quem lê. */
export function localIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

/** prefixo de id/arquivo a partir da data: AAAA-MM-DD_HHMM (local) */
export function datePrefix(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Fatia texto longo em blocos de ~max chars, cortando em fim de parágrafo/frase. */
export function chunkText(text: string, max = 6000): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** hash curto e estável (FNV-1a 32 bits, hex) p/ chave de deduplicação de texto colado */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
