// core/agent/tools/families/lsp.ts → inteligência de código (AGENT_TOOLS.md §7).
// O LSP rico vive no editor; headless caímos no grafo de símbolos / grep. hover e
// rename exigem o LSP do editor → stub honesto (rename é sealGated mas recusa antes).

import { readFile } from "node:fs/promises";
import { extractSymbols } from "@typer/index";
import { grep } from "@typer/retrieval";
import type { Tool } from "./types.js";
import { resolveInWorkspace } from "./helpers.js";

const documentSymbols: Tool = {
  name: "document_symbols",
  family: "lsp",
  description: "Outline de um arquivo (defs via tree-sitter).",
  params: [{ name: "path", type: "string", required: true, description: "arquivo" }],
  returns: "{defs, refs}",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const abs = resolveInWorkspace(ctx.workspace, args.path as string);
    const content = await readFile(abs, "utf8");
    const syms = await extractSymbols(content, args.path as string);
    return syms
      ? { ok: true, value: syms }
      : { ok: false, error: { code: "no_symbols", message: "linguagem sem gramática tree-sitter" } };
  },
};

const gotoDefinition: Tool = {
  name: "goto_definition",
  family: "lsp",
  description: "Localiza a definição de um símbolo (best-effort via grep).",
  params: [
    { name: "symbol", type: "string", required: true, description: "nome do símbolo" },
    { name: "at", type: "Pos", required: false, description: "posição (informativa)" },
  ],
  returns: "localizações prováveis da definição",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const sym = args.symbol as string;
    const hits = await grep({ root: ctx.workspace, terms: [sym] });
    const defs = hits.filter((h) =>
      new RegExp(`\\b(function|class|const|let|var|interface|type|enum|def|fn)\\b[^=]*\\b${sym}\\b`).test(h.text),
    );
    return { ok: true, value: defs.length ? defs : hits.slice(0, 10) };
  },
};

const findReferences: Tool = {
  name: "find_references",
  family: "lsp",
  description: "Encontra usos de um símbolo (best-effort via grep).",
  params: [
    { name: "symbol", type: "string", required: true, description: "nome do símbolo" },
    { name: "at", type: "Pos", required: false, description: "posição (informativa)" },
  ],
  returns: "localizações",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const hits = await grep({ root: ctx.workspace, terms: [args.symbol as string] });
    return { ok: true, value: hits };
  },
};

const hoverInfo: Tool = {
  name: "hover_info",
  family: "lsp",
  description: "Tipo e doc de um símbolo (requer o LSP do editor).",
  params: [
    { name: "symbol", type: "string", required: true, description: "símbolo" },
    { name: "at", type: "Pos", required: true, description: "posição" },
  ],
  returns: "tipo e doc",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async () => ({
    ok: false,
    error: { code: "needs_lsp", message: "hover vem do LSP do editor (indisponível headless)" },
  }),
};

const renameSymbol: Tool = {
  name: "rename_symbol",
  family: "lsp",
  description: "Renomeia um símbolo em todo o projeto (requer o LSP do editor).",
  params: [
    { name: "symbol", type: "string", required: true, description: "símbolo" },
    { name: "at", type: "Pos", required: true, description: "posição" },
    { name: "name", type: "string", required: true, description: "novo nome" },
  ],
  returns: "diff",
  permission: "write",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: true,
  handler: async () => ({
    ok: false,
    error: { code: "needs_lsp", message: "rename seguro vem do LSP do editor (indisponível headless)" },
  }),
};

export const lspTools: Tool[] = [
  documentSymbols,
  gotoDefinition,
  findReferences,
  hoverInfo,
  renameSymbol,
];
