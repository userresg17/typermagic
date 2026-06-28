// core/retrieval/assemble.ts
// Monta o Context sob o orçamento de tokens e o renderiza para o prompt. Puro
// e testável. Política do Estágio 1: o arquivo aberto tem prioridade, depois os
// trechos do grep entram até o teto. A seleção por relevância da Fase 3 troca
// só esta política, não a forma.

import type { Context, ContextFile, Snippet, TokenBudget } from "./types.js";
import { approxTokens } from "./types.js";

/** Decide o que cabe no orçamento. Arquivos primeiro, trechos depois. */
export function assembleContext(
  query: string,
  files: ContextFile[],
  snippets: Snippet[],
  budget: TokenBudget,
): Context {
  const max = budget.maxTokens;
  let used = 0;

  const keptFiles: ContextFile[] = [];
  for (const f of files) {
    const cost = approxTokens(f.content) + approxTokens(f.path);
    if (used + cost > max && keptFiles.length > 0) break;
    if (used + cost > max) {
      // primeiro arquivo já estoura: trunca para caber
      const room = Math.max(0, max - used - approxTokens(f.path));
      const sliced = f.content.slice(0, room * 4);
      keptFiles.push({ ...f, content: sliced, truncated: true });
      used += approxTokens(sliced) + approxTokens(f.path);
      break;
    }
    keptFiles.push(f);
    used += cost;
  }

  const keptSnippets: Snippet[] = [];
  for (const s of snippets) {
    const cost = approxTokens(s.text) + approxTokens(s.file) + 4;
    if (used + cost > max) break;
    keptSnippets.push(s);
    used += cost;
  }

  return {
    query,
    files: keptFiles,
    snippets: keptSnippets,
    approxTokens: used,
  };
}

function lang(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", json: "json", py: "python",
    rs: "rust", go: "go", md: "md", sh: "bash", yml: "yaml", yaml: "yaml",
    css: "css", html: "html",
  };
  return map[ext] ?? "";
}

/** Renderiza o Context como bloco de texto para injetar no prompt. */
export function renderContext(ctx: Context): string {
  const parts: string[] = ["# Contexto do projeto"];

  for (const f of ctx.files) {
    parts.push(`\n## Arquivo: ${f.path}${f.truncated ? " (truncado)" : ""}`);
    parts.push("```" + lang(f.path));
    parts.push(f.content.replace(/\n$/, ""));
    parts.push("```");
  }

  if (ctx.chunks && ctx.chunks.length > 0) {
    parts.push("\n## Trechos recuperados (busca híbrida)");
    for (const c of ctx.chunks) {
      parts.push(`\n### ${c.file}:${c.startLine}-${c.endLine}`);
      parts.push("```" + lang(c.file));
      parts.push(c.text.replace(/\n$/, ""));
      parts.push("```");
    }
  }

  if (ctx.snippets.length > 0) {
    parts.push("\n## Trechos relevantes (busca por palavra)");
    for (const s of ctx.snippets) {
      parts.push(`- ${s.file}:${s.line}: ${s.text}`);
    }
  }

  return parts.join("\n");
}
