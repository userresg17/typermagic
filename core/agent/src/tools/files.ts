// core/agent/tools/families/files.ts → arquivos e edição (AGENT_TOOLS.md §7).
// Escrita do agente passa pelo SELO (sealGated): o handler PRODUZ um FilePlan e o
// dispatcher submete ao ctx.seal (aplica→testa→mantém/reverte). O handler não
// escreve direto.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseEdits, planEdits, type FilePlan } from "@typer/edit";
import type { Tool } from "./types.js";
import { resolveInWorkspace, relInWorkspace } from "./helpers.js";

const IGNORE = new Set(["node_modules", ".git", "dist", "out", ".typer"]);

const readFileTool: Tool = {
  name: "read_file",
  family: "arquivos",
  description: "Lê um arquivo ou um range de linhas.",
  params: [
    { name: "path", type: "string", required: true, description: "caminho do arquivo" },
    { name: "range", type: "Range", required: false, description: "{start,end} 1-based, inclusivo" },
  ],
  returns: "conteúdo do arquivo",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const abs = resolveInWorkspace(ctx.workspace, args.path as string);
    const content = await readFile(abs, "utf8");
    const range = args.range as { start?: number; end?: number } | undefined;
    if (range && (range.start !== undefined || range.end !== undefined)) {
      const lines = content.split("\n");
      const start = Math.max(1, range.start ?? 1);
      const end = Math.min(lines.length, range.end ?? lines.length);
      return { ok: true, value: lines.slice(start - 1, end).join("\n") };
    }
    return { ok: true, value: content };
  },
};

const writeFileTool: Tool = {
  name: "write_file",
  family: "arquivos",
  description: "Escreve um arquivo inteiro (cria ou substitui). Passa pelo selo.",
  params: [
    { name: "path", type: "string", required: true, description: "caminho do arquivo" },
    { name: "content", type: "string", required: true, description: "conteúdo novo" },
  ],
  returns: "FilePlan pendente de selo",
  permission: "write",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: true,
  handler: async (args, ctx) => {
    const rel = args.path as string;
    const abs = resolveInWorkspace(ctx.workspace, rel);
    let before = "";
    let status: FilePlan["status"] = "create";
    try {
      before = await readFile(abs, "utf8");
      status = "modify";
    } catch {
      status = "create";
    }
    const plan: FilePlan = { file: rel, before, after: args.content as string, status, edits: 1 };
    return { ok: true, value: [plan] };
  },
};

const editDiffTool: Tool = {
  name: "edit_diff",
  family: "arquivos",
  description: "Aplica um patch SEARCH/REPLACE sem regenerar o arquivo. Passa pelo selo.",
  params: [
    { name: "path", type: "string", required: true, description: "arquivo alvo" },
    { name: "patch", type: "string", required: true, description: "bloco(s) SEARCH/REPLACE" },
  ],
  returns: "FilePlan pendente de selo",
  permission: "write",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: true,
  handler: async (args, ctx) => {
    const edits = parseEdits(args.patch as string);
    if (edits.length === 0) {
      return { ok: false, error: { code: "no_edits", message: "patch sem blocos SEARCH/REPLACE válidos" } };
    }
    const plans = await planEdits(ctx.workspace, edits);
    const bad = plans.find((p) => p.status === "error");
    if (bad) return { ok: false, error: { code: "apply_failed", message: bad.error ?? "edit não casou" } };
    return { ok: true, value: plans };
  },
};

const multiEditTool: Tool = {
  name: "multi_edit",
  family: "arquivos",
  description: "Aplica vários edits SEARCH/REPLACE (multi-arquivo). Passa pelo selo.",
  params: [{ name: "edits", type: "Edit[]", required: true, description: "[{file,search,replace}]" }],
  returns: "FilePlan[] pendente de selo",
  permission: "write",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: true,
  handler: async (args, ctx) => {
    const edits = args.edits as Array<{ file: string; search: string; replace: string }>;
    if (!Array.isArray(edits) || edits.length === 0) {
      return { ok: false, error: { code: "no_edits", message: "edits vazio" } };
    }
    const plans = await planEdits(ctx.workspace, edits);
    const bad = plans.find((p) => p.status === "error");
    if (bad) return { ok: false, error: { code: "apply_failed", message: bad.error ?? "edit não casou" } };
    return { ok: true, value: plans };
  },
};

const listDirTool: Tool = {
  name: "list_dir",
  family: "arquivos",
  description: "Lista a árvore de um diretório até uma profundidade.",
  params: [
    { name: "path", type: "string", required: true, description: "diretório (relativo ao workspace)" },
    { name: "depth", type: "number", required: false, description: "profundidade, default 2" },
  ],
  returns: "lista de caminhos (dir marcado com /)",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const root = resolveInWorkspace(ctx.workspace, (args.path as string) || ".");
    const maxDepth = (args.depth as number) ?? 2;
    const out: string[] = [];
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth) return;
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }
      for (const name of entries.sort()) {
        if (IGNORE.has(name) || name.startsWith(".")) continue;
        const abs = join(dir, name);
        const s = await stat(abs).catch(() => null);
        if (!s) continue;
        const rel = relInWorkspace(ctx.workspace, abs);
        out.push(s.isDirectory() ? `${rel}/` : rel);
        if (s.isDirectory()) await walk(abs, depth + 1);
      }
    }
    await walk(root, 1);
    return { ok: true, value: out };
  },
};

export const fileTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editDiffTool,
  multiEditTool,
  listDirTool,
];
