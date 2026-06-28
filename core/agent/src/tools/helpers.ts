// core/agent/tools/helpers.ts
// Utilitários compartilhados pelos handlers das ferramentas.

import { resolve, relative, isAbsolute } from "node:path";
import { pickEmbedder, type Embedder } from "@typer/index";
import type { ToolContext } from "./types.js";

/** Embedder do contexto, ou um default (Fake offline) — memória/skills/semântico. */
export function embedderFor(ctx: ToolContext): Embedder {
  if (ctx.deps?.embedder) return ctx.deps.embedder;
  return pickEmbedder({
    hasOpenAI: ctx.deps?.hasOpenAI ?? false,
    local: ctx.deps?.local ?? false,
  }).embedder;
}

/** Resolve um path relativo ao workspace e impede escapar dele (segurança). */
export function resolveInWorkspace(workspace: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(workspace, p);
  const rel = relative(workspace, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`caminho fora do workspace: ${p}`);
  }
  return abs;
}

/** Caminho relativo ao workspace (para exibir/registrar). */
export function relInWorkspace(workspace: string, abs: string): string {
  return relative(workspace, abs);
}
