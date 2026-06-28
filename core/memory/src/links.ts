// core/memory/links.ts
// Parsing de wikilinks [[ ]] e tags #tag no corpo das notas — a base do grafo
// estilo Obsidian. Puro e testável. O corpo da nota é a FONTE DE VERDADE dos
// links (backlinks são derivados, nunca gravados no frontmatter, p/ não amplificar
// escrita: editar uma nota não pode obrigar a reescrever todas que apontam p/ ela).

export interface Wikilink {
  /** alvo cru dentro de [[...]] — pode ser id, título ou slug */
  target: string;
  /** rótulo alternativo em [[alvo|alias]] */
  alias?: string;
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;
const TAG_RE = /(?:^|\s)#(\p{L}[\p{L}\p{N}_/-]*)/gu;
const FENCE_RE = /```[\s\S]*?```|`[^`]*`/g;

/** Extrai os wikilinks do texto (alvo + alias opcional). */
export function parseWikilinks(text: string): Wikilink[] {
  const out: Wikilink[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = m[1]!.trim();
    if (!target) continue;
    const alias = m[2]?.trim();
    out.push(alias ? { target, alias } : { target });
  }
  return out;
}

/** Extrai tags #tag, ignorando blocos de código e headings markdown. Normaliza
 *  para minúsculas. Exige letra após o '#' (descarta #123 e cores em código). */
export function parseTags(text: string): string[] {
  const withoutCode = text.replace(FENCE_RE, " ");
  const out = new Set<string>();
  for (const line of withoutCode.split("\n")) {
    // pula a marca de heading ("# título") para não confundir com tag
    const body = /^#{1,6}\s/.test(line) ? line.replace(/^#{1,6}\s+/, "") : line;
    for (const m of body.matchAll(TAG_RE)) {
      out.add(m[1]!.toLowerCase());
    }
  }
  return [...out];
}

/** Slug estável p/ resolver [[Título]] independentemente de caixa/pontuação. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acentos (combining diacritics)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolve um alvo de wikilink contra o índice (id → título → slug). null =
 *  dangling (nó fantasma, estilo Obsidian). O aliasIndex mapeia id, título em
 *  minúsculas e slug → id. */
export function resolveLink(target: string, aliasIndex: Map<string, string>): string | null {
  return (
    aliasIndex.get(target) ??
    aliasIndex.get(target.toLowerCase()) ??
    aliasIndex.get(slugify(target)) ??
    null
  );
}
