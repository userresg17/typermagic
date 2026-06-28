// core/retrieval/ripgrep.ts
// Wrapper fino sobre o ripgrep. Sem embeddings: só busca textual por palavra.
// Respeita o .gitignore por padrão, então node_modules e dist ficam de fora.
// O índice semântico da Fase 3 substitui este sinal, não o chamador.

import { execFile } from "node:child_process";
import type { Snippet } from "./types.js";

const RG = process.env.TYPER_RG_PATH ?? "rg";

export interface GrepOptions {
  root: string;
  terms: string[];
  /** teto de casamentos por arquivo, para não inundar com um termo comum */
  maxPerFile?: number;
  /** teto global de trechos retornados */
  maxTotal?: number;
}

/** Roda o ripgrep e devolve os trechos casados. Retorna [] quando o rg não
 *  acha nada (exit 1) ou não está instalado, em vez de estourar. */
export async function grep(opts: GrepOptions): Promise<Snippet[]> {
  const { root, terms } = opts;
  const maxPerFile = opts.maxPerFile ?? 4;
  const maxTotal = opts.maxTotal ?? 30;
  if (terms.length === 0) return [];

  const args = [
    "--json",
    "--smart-case",
    "--max-columns",
    "300",
    "--max-count",
    String(maxPerFile),
  ];
  for (const t of terms) args.push("-e", t);
  args.push("--", root);

  const stdout = await runRg(args);
  if (!stdout) return [];

  const snippets: Snippet[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const match = parseMatch(ev);
    if (match) {
      snippets.push(match);
      if (snippets.length >= maxTotal) break;
    }
  }
  return snippets;
}

interface RgMatchData {
  path?: { text?: string };
  lines?: { text?: string };
  line_number?: number;
}

function parseMatch(ev: unknown): Snippet | null {
  if (typeof ev !== "object" || ev === null) return null;
  const obj = ev as { type?: string; data?: RgMatchData };
  if (obj.type !== "match" || !obj.data) return null;
  const path = obj.data.path?.text;
  const text = obj.data.lines?.text;
  const line = obj.data.line_number;
  if (!path || text === undefined || line === undefined) return null;
  return { file: path, line, text: text.replace(/\n$/, "").trim() };
}

function runRg(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      RG,
      args,
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        // exit 1 = sem casamentos; ENOENT = rg ausente. Ambos => sem trechos.
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            console.error(
              "\x1b[33maviso:\x1b[0m ripgrep (rg) não encontrado; seguindo sem trechos.",
            );
          }
          resolve(stdout ?? "");
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Diz se o ripgrep está disponível no ambiente. */
export async function ripgrepAvailable(): Promise<boolean> {
  const out = await new Promise<boolean>((resolve) => {
    execFile(RG, ["--version"], (err) => resolve(!err));
  });
  return out;
}
