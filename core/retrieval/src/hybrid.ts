// core/retrieval/hybrid.ts
// Recuperação híbrida (Fase 3, subfases 3.5/3.6). Combina três sinais —
// semântico (índice), texto (ripgrep) e grafo de símbolos (proximidade) — e
// monta o contexto sob orçamento de tokens. Implementa a mesma interface
// Retriever do Estágio 1, então substitui o ripgrep cru sem trocar o chamador.

import type { Indexer, SymbolGraph } from "@typer/index";
import { readContextFile } from "./file-context.js";
import { grep } from "./ripgrep.js";
import { extractTerms } from "./terms.js";
import { approxTokens } from "./types.js";
import type {
  Context,
  ContextFile,
  RetrievedChunk,
  Retriever,
  Snippet,
  TokenBudget,
} from "./types.js";

export interface HybridRetrieverOptions {
  root: string;
  indexer: Indexer;
  /** grafo de símbolos para o sinal de proximidade (opcional) */
  graph?: SymbolGraph;
  /** arquivos abertos: lidos inteiros e usados como semente do grafo */
  files?: string[];
  /** liga a busca textual por ripgrep */
  grep?: boolean;
  /** quantos chunks semânticos buscar antes de podar */
  semanticK?: number;
  weights?: { semantic?: number; graph?: number };
}

export class HybridRetriever implements Retriever {
  private readonly root: string;
  private readonly indexer: Indexer;
  private readonly graph: SymbolGraph | undefined;
  private readonly files: string[];
  private readonly useGrep: boolean;
  private readonly semanticK: number;
  private readonly wSemantic: number;
  private readonly wGraph: number;

  constructor(opts: HybridRetrieverOptions) {
    this.root = opts.root;
    this.indexer = opts.indexer;
    this.graph = opts.graph;
    this.files = opts.files ?? [];
    this.useGrep = opts.grep ?? false;
    this.semanticK = opts.semanticK ?? 12;
    this.wSemantic = opts.weights?.semantic ?? 1;
    this.wGraph = opts.weights?.graph ?? 0.3;
  }

  async retrieve(query: string, budget: TokenBudget): Promise<Context> {
    // sinal do grafo: arquivos próximos dos arquivos abertos
    const graphScore = new Map<string, number>();
    if (this.graph) {
      for (const f of this.files) {
        for (const rel of this.graph.related(f)) {
          graphScore.set(rel.file, Math.max(graphScore.get(rel.file) ?? 0, rel.score));
        }
      }
    }

    // sinal semântico: chunks mais próximos da consulta no índice
    const semantic = await this.indexer.query(query, this.semanticK);
    const chunks: RetrievedChunk[] = semantic.map((s) => {
      const g = graphScore.get(s.chunk.file) ?? 0;
      const score = s.score * this.wSemantic + g * this.wGraph;
      return {
        file: s.chunk.file,
        startLine: s.chunk.startLine,
        endLine: s.chunk.endLine,
        text: s.chunk.text,
        score,
        source: g > 0 ? "hybrid" : "semantic",
      };
    });
    chunks.sort((a, b) => b.score - a.score);

    // sinal de texto: ripgrep por palavra (opcional)
    const snippets = this.useGrep
      ? await grep({ root: this.root, terms: extractTerms(query) })
      : [];

    return this.assemble(query, chunks, snippets, budget);
  }

  /** Monta o Context sob orçamento: arquivos abertos, depois chunks, depois
   *  trechos de texto. Poda o que não cabe (3.6). */
  private async assemble(
    query: string,
    ranked: RetrievedChunk[],
    rawSnippets: Snippet[],
    budget: TokenBudget,
  ): Promise<Context> {
    const max = budget.maxTokens;
    let used = 0;

    const files: ContextFile[] = [];
    for (const path of this.files) {
      const f = await readContextFile(this.root, path).catch(() => null);
      if (!f) continue;
      const cost = approxTokens(f.content) + approxTokens(f.path);
      if (used + cost > max) break;
      files.push(f);
      used += cost;
    }

    const chunks: RetrievedChunk[] = [];
    const covered = new Set<string>(); // file:line cobertos por chunks
    for (const c of ranked) {
      const cost = approxTokens(c.text) + approxTokens(c.file) + 8;
      if (used + cost > max) break;
      chunks.push(c);
      used += cost;
      for (let l = c.startLine; l <= c.endLine; l++) covered.add(`${c.file}:${l}`);
    }

    const snippets: Snippet[] = [];
    for (const s of rawSnippets) {
      if (covered.has(`${s.file}:${s.line}`)) continue; // já está num chunk
      const cost = approxTokens(s.text) + approxTokens(s.file) + 4;
      if (used + cost > max) break;
      snippets.push(s);
      used += cost;
    }

    return { query, files, chunks, snippets, approxTokens: used };
  }
}
