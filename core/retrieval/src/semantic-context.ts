// core/retrieval/semantic-context.ts
// Recuperação HÍBRIDA com índice PERSISTIDO: indexa um conjunto LIMITADO de
// arquivos (abertos + candidatos do ripgrep p/ a query), monta o grafo de símbolos
// e usa o HybridRetriever (semântico + grafo + texto sob orçamento). Carrega de
// .typer/index.json, re-embeda só o que mudou (hash) e salva. Puro (sem console):
// devolve {context, stats} — quem chama loga. Compartilhado por CLI e Core Server.

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  Indexer,
  FileVectorStore,
  SymbolGraph,
  extractSymbols,
  type Embedder,
} from "@typer/index";
import { HybridRetriever } from "./hybrid.js";
import { renderContext } from "./assemble.js";
import { grep } from "./ripgrep.js";
import { extractTerms } from "./terms.js";

/** Teto de arquivos a indexar por run (controla custo de embeddings). */
const MAX_FILES = 40;
/** Pula arquivos grandes demais (binários/gerados). */
const MAX_BYTES = 200_000;

export interface SemanticStats {
  indexed: number;
  embedded: number;
  reused: number;
  files: number;
  snippets: number;
  approxTokens: number;
}

/** Caminho do índice persistido do projeto. */
export function indexPath(root: string): string {
  return join(root, ".typer", "index.json");
}

function hashContent(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Arquivos candidatos: abertos (--file) + matches do ripgrep p/ os termos. */
async function candidateFiles(
  root: string,
  openFiles: string[],
  query: string,
): Promise<string[]> {
  const set = new Set<string>(openFiles);
  try {
    const terms = extractTerms(query);
    if (terms.length > 0) {
      const hits = await grep({ root, terms });
      for (const h of hits) {
        if (set.size >= MAX_FILES) break;
        set.add(h.file);
      }
    }
  } catch {
    /* sem ripgrep: fica só com os arquivos abertos */
  }
  return [...set].slice(0, MAX_FILES);
}

/** Monta o contexto híbrido (string pronta p/ o system) + stats; context "" se vazio. */
export async function buildSemanticContext(opts: {
  root: string;
  files: string[];
  grep: boolean;
  query: string;
  embedder: Embedder;
}): Promise<{ context: string; stats: SemanticStats }> {
  const { root, files, grep: useGrep, query, embedder } = opts;
  const store = new FileVectorStore(indexPath(root));
  await store.load();
  const indexer = new Indexer(embedder, store);
  const graph = new SymbolGraph();

  const candidates = await candidateFiles(root, files, query);
  let embedded = 0;
  let reused = 0;
  for (const file of candidates) {
    let content: string;
    try {
      content = await readFile(resolve(root, file), "utf8");
    } catch {
      continue; // arquivo some/binário: ignora
    }
    if (content.length > MAX_BYTES) continue;
    const hash = hashContent(content);
    if (store.isFresh(file, hash)) {
      reused++; // já indexado com este conteúdo → não re-embeda
    } else {
      await indexer.indexFile(file, content);
      store.setFileHash(file, hash);
      embedded++;
    }
    const syms = await extractSymbols(content, file);
    if (syms) graph.addFile(file, syms);
  }
  await store.save();

  const retriever = new HybridRetriever({ root, indexer, graph, files, grep: useGrep });
  const ctx = await retriever.retrieve(query, { maxTokens: 6000 });
  const stats: SemanticStats = {
    indexed: embedded + reused,
    embedded,
    reused,
    files: ctx.files.length,
    snippets: ctx.snippets.length,
    approxTokens: ctx.approxTokens,
  };
  if (ctx.files.length === 0 && ctx.snippets.length === 0) {
    return { context: "", stats };
  }
  return { context: renderContext(ctx), stats };
}
