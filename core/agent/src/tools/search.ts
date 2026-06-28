// core/agent/tools/families/search.ts → busca e contexto (AGENT_TOOLS.md §7).
// Liga ao @typer/retrieval (grep, contexto híbrido) e ao @typer/index (índice
// vetorial persistido, grafo de símbolos).

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  Indexer,
  FileVectorStore,
  SymbolGraph,
  extractSymbols,
} from "@typer/index";
import {
  grep,
  buildSemanticContext,
  extractTerms,
} from "@typer/retrieval";
import type { Tool } from "./types.js";
import { embedderFor, relInWorkspace } from "./helpers.js";

const MAX_FILES = 40;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

async function candidates(workspace: string, query: string): Promise<string[]> {
  const terms = extractTerms(query);
  if (terms.length === 0) return [];
  try {
    const hits = await grep({ root: workspace, terms });
    return [...new Set(hits.map((h) => h.file))].slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

/** Converte um glob (*, **, ?) num RegExp, sem placeholders frágeis. */
function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += ".";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(out + "$");
}

const semanticSearch: Tool = {
  name: "semantic_search",
  family: "busca",
  description: "Busca semântica por trechos relevantes à query (índice vetorial).",
  params: [
    { name: "query", type: "string", required: true, description: "o que procurar" },
    { name: "k", type: "number", required: false, description: "quantos trechos, default 8" },
  ],
  returns: "trechos {file,startLine,endLine,score,text}",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const query = args.query as string;
    const k = (args.k as number) ?? 8;
    const store = new FileVectorStore(join(ctx.workspace, ".typer", "index.json"));
    await store.load();
    const indexer = new Indexer(embedderFor(ctx), store);
    for (const file of await candidates(ctx.workspace, query)) {
      const content = await readFile(resolve(ctx.workspace, file), "utf8").catch(() => null);
      if (content === null || content.length > 200_000) continue;
      const h = hash(content);
      if (!store.isFresh(file, h)) {
        await indexer.indexFile(file, content);
        store.setFileHash(file, h);
      }
    }
    await store.save();
    const scored = await indexer.query(query, k);
    return {
      ok: true,
      value: scored.map((s) => ({
        file: s.chunk.file,
        startLine: s.chunk.startLine,
        endLine: s.chunk.endLine,
        score: s.score,
        text: s.chunk.text,
      })),
    };
  },
};

const grepSearch: Tool = {
  name: "grep_search",
  family: "busca",
  description: "Busca textual por padrão via ripgrep.",
  params: [
    { name: "pattern", type: "string", required: true, description: "termo/padrão" },
    { name: "glob", type: "string", required: false, description: "filtro de arquivos (informativo)" },
  ],
  returns: "matches {file,line,text}",
  permission: "read",
  exec: "subprocess",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const pattern = args.pattern as string;
    const hits = await grep({ root: ctx.workspace, terms: [pattern] });
    return { ok: true, value: hits };
  },
};

const symbolGraphQuery: Tool = {
  name: "symbol_graph_query",
  family: "busca",
  description: "Vizinhos de um símbolo no grafo (arquivos que definem/usam).",
  params: [{ name: "symbol", type: "string", required: true, description: "nome do símbolo" }],
  returns: "{definedIn, relatedFiles}",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const symbol = args.symbol as string;
    const graph = new SymbolGraph();
    const files = await candidates(ctx.workspace, symbol);
    let seed = "";
    for (const file of files) {
      const content = await readFile(resolve(ctx.workspace, file), "utf8").catch(() => null);
      if (content === null) continue;
      const syms = await extractSymbols(content, file);
      if (syms) {
        graph.addFile(file, syms);
        if (!seed && syms.defs.some((d) => d.name === symbol)) seed = file;
      }
    }
    const definedIn = graph.definitionsOf(symbol);
    const related = seed ? graph.related(seed, 8) : [];
    return { ok: true, value: { definedIn, relatedFiles: related } };
  },
};

const findFiles: Tool = {
  name: "find_files",
  family: "busca",
  description: "Lista arquivos que casam um glob (*, **, ?).",
  params: [{ name: "glob", type: "string", required: true, description: "padrão glob" }],
  returns: "paths",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const re = globToRegExp(args.glob as string);
    const out: string[] = [];
    const skip = new Set(["node_modules", ".git", "dist", "out", ".typer"]);
    async function walk(dir: string): Promise<void> {
      if (out.length >= 500) return;
      const entries = await readdir(dir).catch(() => [] as string[]);
      for (const name of entries) {
        if (skip.has(name)) continue;
        const abs = join(dir, name);
        const s = await stat(abs).catch(() => null);
        if (!s) continue;
        if (s.isDirectory()) await walk(abs);
        else {
          const rel = relInWorkspace(ctx.workspace, abs);
          if (re.test(rel)) out.push(rel);
        }
      }
    }
    await walk(ctx.workspace);
    return { ok: true, value: out };
  },
};

const retrieveContext: Tool = {
  name: "retrieve_context",
  family: "busca",
  description: "Monta o contexto híbrido do projeto p/ a query (semântico+grafo+texto).",
  params: [
    { name: "query", type: "string", required: true, description: "tarefa/pergunta" },
    { name: "budget", type: "number", required: false, description: "orçamento de tokens (informativo)" },
  ],
  returns: "contexto em markdown",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const { context } = await buildSemanticContext({
      root: ctx.workspace,
      files: [],
      grep: true,
      query: args.query as string,
      embedder: embedderFor(ctx),
    });
    return { ok: true, value: context };
  },
};

export const searchTools: Tool[] = [
  semanticSearch,
  grepSearch,
  symbolGraphQuery,
  findFiles,
  retrieveContext,
];
