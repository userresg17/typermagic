// core/retrieval/file-context.ts
// Lê um arquivo-alvo do disco (o "arquivo aberto"). Guarda contra arquivo
// gigante: trunca em um teto de chars e marca truncated.

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContextFile } from "./types.js";

const MAX_FILE_CHARS = 60_000;

/** Lê um arquivo relativo à raiz. Lança erro claro se não existir. */
export async function readContextFile(
  root: string,
  path: string,
): Promise<ContextFile> {
  const abs = resolve(root, path);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`Arquivo não encontrado: ${path}`);
  }
  if (!info.isFile()) {
    throw new Error(`Não é um arquivo: ${path}`);
  }
  const raw = await readFile(abs, "utf8");
  const truncated = raw.length > MAX_FILE_CHARS;
  return {
    path,
    content: truncated ? raw.slice(0, MAX_FILE_CHARS) : raw,
    truncated,
  };
}
