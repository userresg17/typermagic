// core/memory/graph.ts
// Grafo de notas estilo Obsidian: nós = memórias, arestas = wikilinks. Derivado do
// vault na carga (sem banco de grafo externo). Espelha o SymbolGraph de @typer/index
// (mesma caminhada BFS com decaimento por profundidade). Backlinks = arestas
// invertidas. Links não resolvidos viram "dangling" (nós fantasma, como no Obsidian).

import type { MemoryEntry, MemoryKind } from "./types.js";
import { parseWikilinks, parseTags, slugify, resolveLink } from "./links.js";

export interface GraphNode {
  id: string;
  title: string;
  kind: MemoryKind;
  tags: string[];
  importance: number;
  confidence: number;
  verified: boolean;
  /** grau total (out+in) — vira o raio do nó na visualização */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "link";
}

export interface NoteGraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** grupos por tag — p/ colorir/clusterizar sem explodir o grafo de arestas */
  tags: { tag: string; notes: string[] }[];
  stats: { notes: number; links: number; dangling: number };
}

interface NodeMeta {
  id: string;
  title: string;
  kind: MemoryKind;
  tags: string[];
  importance: number;
  confidence: number;
  verified: boolean;
}

/** Título legível de uma nota: o campo title, senão a 1ª linha não vazia do texto
 *  (tirando um prefixo "Tarefa:" comum nos episódios), capada. */
export function titleOf(entry: MemoryEntry): string {
  if (entry.title && entry.title.trim()) return entry.title.trim();
  const first = entry.text.split("\n").find((l) => l.trim().length > 0) ?? entry.id;
  return first.replace(/^Tarefa:\s*/i, "").trim().slice(0, 80);
}

export class NoteGraph {
  private readonly meta = new Map<string, NodeMeta>();
  private readonly outLinks = new Map<string, Set<string>>();
  private readonly inLinks = new Map<string, Set<string>>();
  private readonly unresolved = new Map<string, Set<string>>();
  private readonly notesByTag = new Map<string, Set<string>>();
  private readonly aliasIndex = new Map<string, string>();

  /** Constrói o grafo a partir das entradas. Mutações: preenche entry.links com os
   *  ids resolvidos (conveniência p/ a UI; a fonte continua sendo o corpo). */
  static build(entries: MemoryEntry[]): NoteGraph {
    const g = new NoteGraph();

    // 1. índice de resolução: id, título (minúsculas) e slug → id
    for (const e of entries) {
      const title = titleOf(e);
      g.aliasIndex.set(e.id, e.id);
      g.aliasIndex.set(title.toLowerCase(), e.id);
      g.aliasIndex.set(slugify(title), e.id);
      g.meta.set(e.id, {
        id: e.id,
        title,
        kind: e.kind,
        tags: e.tags ?? [],
        importance: e.importance,
        confidence: e.confidence,
        verified: e.verified,
      });
      g.outLinks.set(e.id, new Set());
      g.inLinks.set(e.id, new Set());
    }

    // 2. arestas (links resolvidos) + dangling + tags
    for (const e of entries) {
      const resolved: string[] = [];
      for (const link of parseWikilinks(e.text)) {
        const target = resolveLink(link.target, g.aliasIndex);
        if (target && target !== e.id) {
          g.outLinks.get(e.id)!.add(target);
          g.inLinks.get(target)!.add(e.id);
          resolved.push(target);
        } else if (!target) {
          if (!g.unresolved.has(e.id)) g.unresolved.set(e.id, new Set());
          g.unresolved.get(e.id)!.add(link.target);
        }
      }
      e.links = resolved;

      const tags = new Set([...(e.tags ?? []), ...parseTags(e.text)]);
      for (const tag of tags) {
        if (!g.notesByTag.has(tag)) g.notesByTag.set(tag, new Set());
        g.notesByTag.get(tag)!.add(e.id);
      }
      // reflete as tags finais no meta (frontmatter + inline)
      const m = g.meta.get(e.id);
      if (m) m.tags = [...tags];
    }

    return g;
  }

  private neighborIds(id: string): string[] {
    const out = this.outLinks.get(id);
    const inn = this.inLinks.get(id);
    const set = new Set<string>();
    if (out) for (const x of out) set.add(x);
    if (inn) for (const x of inn) set.add(x);
    return [...set];
  }

  /** Backlinks: quem aponta para esta nota. */
  backlinks(id: string): string[] {
    return [...(this.inLinks.get(id) ?? [])];
  }

  /** Vizinhos diretos (links + backlinks). */
  neighbors(id: string): string[] {
    return this.neighborIds(id);
  }

  /** Caminhada com decaimento 0.5^d a partir de uma semente, fundindo por max.
   *  EXCLUI a própria semente (só vizinhos, profundidade >= 1). É o "spreading
   *  activation" do recall: nota fortemente ligada a um hit sobe. */
  walk(startId: string, maxDepth = 2): Map<string, number> {
    const out = new Map<string, number>();
    const visited = new Set<string>([startId]);
    let frontier = [startId];
    for (let d = 1; d <= maxDepth; d++) {
      const w = Math.pow(0.5, d);
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of this.neighborIds(id)) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          out.set(nb, Math.max(out.get(nb) ?? 0, w));
          next.push(nb);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Top-k notas relacionadas por proximidade no grafo (links+backlinks). */
  related(id: string, k = 8, depth = 2): Array<{ id: string; weight: number }> {
    return [...this.walk(id, depth).entries()]
      .map(([nid, weight]) => ({ id: nid, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, k);
  }

  /** Notas com uma tag. */
  byTag(tag: string): string[] {
    return [...(this.notesByTag.get(tag.toLowerCase()) ?? [])];
  }

  /** Snapshot serializável p/ a visualização (graph view). */
  toGraphView(): NoteGraphView {
    const nodes: GraphNode[] = [];
    for (const m of this.meta.values()) {
      const degree = (this.outLinks.get(m.id)?.size ?? 0) + (this.inLinks.get(m.id)?.size ?? 0);
      nodes.push({ ...m, degree });
    }
    const edges: GraphEdge[] = [];
    for (const [src, tgts] of this.outLinks) {
      for (const t of tgts) edges.push({ source: src, target: t, type: "link" });
    }
    const tags = [...this.notesByTag.entries()].map(([tag, ids]) => ({ tag, notes: [...ids] }));
    let dangling = 0;
    for (const set of this.unresolved.values()) dangling += set.size;
    return { nodes, edges, tags, stats: { notes: nodes.length, links: edges.length, dangling } };
  }
}
