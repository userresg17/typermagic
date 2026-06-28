// core/memory/store.ts
// Memória indexada estilo Obsidian (v2): escreve no vault markdown, indexa por
// embedding e recupera por um score híbrido — semântico + caminhada no grafo de
// wikilinks + overlap léxico — modulado por confiança e procedência. Dedup antes de
// inserir. O grafo de notas é derivado do vault (graph.ts). Embeddings
// provider-agnósticos (ADR-006).

import { createHash } from "node:crypto";
import { cosineSimilarity, type Embedder } from "@typer/index";
import { readAll, writeEntry } from "./vault.js";
import {
  scoreMemory,
  recencyScore,
  tokenize,
  lexicalScore,
  sourceTrust,
  VERIFIED_BOOST,
  DEFAULT_WEIGHTS,
  type RecallWeights,
} from "./recall.js";
import { NoteGraph, type NoteGraphView } from "./graph.js";
import { parseTags } from "./links.js";
import type {
  MemoryEntry,
  MemoryInput,
  MemoryKind,
  MemoryStore,
} from "./types.js";

interface Stored {
  entry: MemoryEntry;
  vector: number[];
}

export interface MarkdownMemoryOptions {
  dir: string;
  embedder: Embedder;
  weights?: RecallWeights;
  dedupThreshold?: number;
  halfLifeHours?: number;
  clock?: () => number;
  /** quantas sementes semânticas alimentam a caminhada no grafo (v2) */
  graphSeeds?: number;
  /** profundidade da caminhada no grafo (v2) */
  graphDepth?: number;
}

export class MarkdownMemory implements MemoryStore {
  private readonly entries = new Map<string, Stored>();
  private readonly dir: string;
  private readonly embedder: Embedder;
  private readonly weights: RecallWeights;
  private readonly dedupThreshold: number;
  private readonly halfLifeHours: number;
  private readonly clock: () => number;
  private readonly graphSeeds: number;
  private readonly graphDepth: number;
  /** grafo de notas, derivado das entradas; invalidado a cada escrita */
  private noteGraph: NoteGraph | null = null;

  constructor(opts: MarkdownMemoryOptions) {
    this.dir = opts.dir;
    this.embedder = opts.embedder;
    this.weights = opts.weights ?? DEFAULT_WEIGHTS;
    this.dedupThreshold = opts.dedupThreshold ?? 0.97;
    this.halfLifeHours = opts.halfLifeHours ?? 24;
    this.clock = opts.clock ?? (() => Date.now());
    this.graphSeeds = opts.graphSeeds ?? 8;
    this.graphDepth = opts.graphDepth ?? 2;
  }

  /** Merge das tags do frontmatter com as #inline do corpo (idempotente). */
  private enrich(entry: MemoryEntry): void {
    const merged = new Set<string>([...(entry.tags ?? []), ...parseTags(entry.text)]);
    if (merged.size > 0) entry.tags = [...merged];
  }

  /** Grafo de notas (lazy; reconstruído quando invalidado por escrita). */
  private graphOf(): NoteGraph {
    if (!this.noteGraph) {
      this.noteGraph = NoteGraph.build([...this.entries.values()].map((s) => s.entry));
    }
    return this.noteGraph;
  }

  /** Carrega as entradas já no vault e as reindexa em memória. */
  async load(): Promise<void> {
    const existing = await readAll(this.dir);
    if (existing.length === 0) return;
    const vectors = await this.embedder.embed(existing.map((e) => e.text));
    existing.forEach((entry, i) => {
      this.enrich(entry);
      this.entries.set(entry.id, { entry, vector: vectors[i] ?? [] });
    });
    this.noteGraph = null; // reconstrói no 1º uso
  }

  writeEpisode(e: MemoryInput): Promise<MemoryEntry | null> {
    return this.write("episodic", e);
  }

  writeSemantic(f: MemoryInput): Promise<MemoryEntry | null> {
    return this.write("semantic", f);
  }

  private async write(kind: MemoryKind, input: MemoryInput): Promise<MemoryEntry | null> {
    const text = input.text.trim();
    if (!text) return null;

    const [vector] = await this.embedder.embed([text]);
    if (!vector) return null;

    // dedup: descarta se quase idêntico a algo já guardado
    for (const stored of this.entries.values()) {
      if (cosineSimilarity(vector, stored.vector) >= this.dedupThreshold) {
        return null;
      }
    }

    const now = this.clock();
    const at = input.at ?? new Date(now).toISOString();
    const id = `${kind}-${createHash("sha256").update(text + at).digest("hex").slice(0, 12)}`;
    const verified = input.verified ?? false;
    const entry: MemoryEntry = {
      id,
      kind,
      text,
      at,
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? (verified ? 1 : 0.6),
      source: input.source ?? "agent",
      verified,
      ...(input.title ? { title: input.title } : {}),
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    };
    this.enrich(entry);

    await writeEntry(this.dir, entry);
    this.entries.set(id, { entry, vector });
    this.noteGraph = null; // o grafo mudou
    return entry;
  }

  /**
   * Consolidação (5.8): destila memória semântica da episódica. Agrupa
   * episódios parecidos, sumariza cada cluster com suporte suficiente, e grava
   * o resultado como fato semântico — não escrito à mão. A confiança cresce com
   * o suporte; o dedup do writeSemantic evita repetir fatos já destilados.
   */
  async consolidate(opts: {
    summarize: (texts: string[]) => Promise<string>;
    minSupport?: number;
    simThreshold?: number;
  }): Promise<MemoryEntry[]> {
    const minSupport = opts.minSupport ?? 2;
    const simThreshold = opts.simThreshold ?? 0.5;

    const eps = [...this.entries.values()].filter((s) => s.entry.kind === "episodic");
    const used = new Set<string>();
    const created: MemoryEntry[] = [];

    for (const a of eps) {
      if (used.has(a.entry.id)) continue;
      const cluster = [a];
      used.add(a.entry.id);
      for (const b of eps) {
        if (used.has(b.entry.id)) continue;
        if (cosineSimilarity(a.vector, b.vector) >= simThreshold) {
          cluster.push(b);
          used.add(b.entry.id);
        }
      }
      if (cluster.length < minSupport) continue;

      const text = await opts.summarize(cluster.map((c) => c.entry.text));
      const fact = await this.writeSemantic({
        text,
        source: "consolidation",
        importance: 0.8,
        confidence: Math.min(1, 0.5 + 0.1 * cluster.length),
      });
      if (fact) created.push(fact);
    }
    return created;
  }

  async recall(query: string, k: number): Promise<MemoryEntry[]> {
    if (this.entries.size === 0) return [];
    const [qv] = await this.embedder.embed([query]);
    if (!qv) return [];
    const now = this.clock();
    const terms = tokenize(query);
    const graph = this.graphOf();

    // sinais base por entrada
    const base = [...this.entries.values()].map(({ entry, vector }) => {
      const relevance = Math.max(0, cosineSimilarity(qv, vector));
      const text = lexicalScore(terms, entry.text, entry.tags ?? []);
      const atMs = Date.parse(entry.at) || now;
      const recency = recencyScore(atMs, now, this.halfLifeHours);
      return { entry, relevance, text, recency };
    });

    // caminhada no grafo a partir das sementes mais relevantes (spreading activation):
    // uma nota fracamente semelhante mas fortemente ligada a um hit sobe.
    const seeds = [...base].sort((a, b) => b.relevance - a.relevance).slice(0, this.graphSeeds);
    const gscore = new Map<string, number>();
    for (const s of seeds) {
      for (const [id, w] of graph.walk(s.entry.id, this.graphDepth)) {
        gscore.set(id, Math.max(gscore.get(id) ?? 0, s.relevance * w));
      }
    }

    const scored = base.map(({ entry, relevance, text, recency }) => {
      const g = gscore.get(entry.id) ?? 0;
      const s =
        scoreMemory(
          { recency, importance: entry.importance, relevance, confidence: entry.confidence, text, graph: g },
          this.weights,
        ) *
        (entry.verified ? VERIFIED_BOOST : 1) *
        sourceTrust(entry.source);
      return { entry, s };
    });

    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, k).map((x) => x.entry);
  }

  // ---- API do grafo (memória v2 / visualização) ----

  /** Snapshot do grafo de notas p/ a graph view. */
  graphView(): NoteGraphView {
    return this.graphOf().toGraphView();
  }

  /** Uma nota pelo id. */
  note(id: string): MemoryEntry | undefined {
    return this.entries.get(id)?.entry;
  }

  /** Notas que apontam para esta (backlinks). */
  backlinks(id: string): MemoryEntry[] {
    return this.graphOf()
      .backlinks(id)
      .map((i) => this.entries.get(i)?.entry)
      .filter((e): e is MemoryEntry => e !== undefined);
  }

  /** Notas com uma tag. */
  byTag(tag: string): MemoryEntry[] {
    return this.graphOf()
      .byTag(tag)
      .map((i) => this.entries.get(i)?.entry)
      .filter((e): e is MemoryEntry => e !== undefined);
  }

  size(): number {
    return this.entries.size;
  }
}
