// core/engine/context.ts
// Montagem do bloco de contexto. Dois caminhos: ripgrep cru (rápido e grátis, o
// default) e híbrido (índice semântico + grafo + texto, opt-in). A lógica vive em
// @typer/retrieval; aqui a Engine só escolhe o caminho e devolve o bloco + stats
// (a superfície decide como logar). O bloco vai para a posição de `system` (prefixo
// estável p/ o cache de prompt); conteúdo não confiável NUNCA entra como instrução.

import { RipgrepRetriever, renderContext, buildSemanticContext } from "@typer/retrieval";
import { pickEmbedder, type Embedder, type EmbedderChoice } from "@typer/index";
import { hasKey } from "@typer/router";

export interface ContextResult {
  block: string;
  files: number;
  snippets: number;
  approxTokens: number;
}

/** Escolhe o embedder compartilhado por retrieval híbrido, memória, skills e
 *  consolidação. Offline → FakeEmbedder (degrada com graça). */
export async function pickEngineEmbedder(local: boolean): Promise<EmbedderChoice> {
  return pickEmbedder({ hasOpenAI: await hasKey("openai"), local });
}

/** Contexto por ripgrep cru (o default da fundação). */
export async function buildRipgrepContext(
  root: string,
  files: string[],
  grep: boolean,
  query: string,
): Promise<ContextResult> {
  const retriever = new RipgrepRetriever({ root, files, grep });
  const ctx = await retriever.retrieve(query, { maxTokens: 6000 });
  if (ctx.files.length === 0 && ctx.snippets.length === 0) {
    return { block: "", files: 0, snippets: 0, approxTokens: 0 };
  }
  return {
    block: renderContext(ctx),
    files: ctx.files.length,
    snippets: ctx.snippets.length,
    approxTokens: ctx.approxTokens,
  };
}

/** Contexto híbrido (semântico + grafo + texto sob orçamento de tokens). */
export async function buildHybridContext(opts: {
  root: string;
  files: string[];
  grep: boolean;
  query: string;
  embedder: Embedder;
}): Promise<ContextResult> {
  const { context, stats } = await buildSemanticContext(opts);
  return {
    block: context ?? "",
    files: stats.files,
    snippets: stats.snippets,
    approxTokens: stats.approxTokens,
  };
}

/** Concatena uma seção ao bloco de contexto (no fim). */
export function appendSection(block: string, section: string): string {
  if (!section) return block;
  return block ? `${block}\n\n${section}` : section;
}

/** Prepende uma seção (ex.: a âncora do handoff vai no TOPO). */
export function prependSection(block: string, section: string): string {
  if (!section) return block;
  return block ? `${section}\n\n${block}` : section;
}
