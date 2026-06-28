// core/index/languages.ts
// Carrega gramáticas tree-sitter (WASM, via tree-sitter-wasms) sob demanda, com
// cache. Mapa de extensão → gramática. web-tree-sitter 0.20.8 (default export).

import { createRequire } from "node:module";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);

// extensão → nome da gramática em tree-sitter-wasms (out/tree-sitter-<nome>.wasm)
const GRAMMARS: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
};

export function grammarNameFor(file: string): string | null {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return GRAMMARS[ext] ?? null;
}

let initPromise: Promise<void> | null = null;
const cache = new Map<string, Parser.Language>();

function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = Parser.init();
  return initPromise;
}

/** Carrega (e cacheia) a gramática pelo nome. null se indisponível. */
export async function loadLanguage(
  name: string,
): Promise<Parser.Language | null> {
  const cached = cache.get(name);
  if (cached) return cached;
  try {
    await ensureInit();
    const wasmPath = require.resolve(
      `tree-sitter-wasms/out/tree-sitter-${name}.wasm`,
    );
    const lang = await Parser.Language.load(wasmPath);
    cache.set(name, lang);
    return lang;
  } catch {
    return null; // gramática ausente: o chamador cai no chunker simples
  }
}

/** Um parser pronto para o arquivo, ou null se não há gramática. */
export async function parserFor(file: string): Promise<Parser | null> {
  const name = grammarNameFor(file);
  if (!name) return null;
  const lang = await loadLanguage(name);
  if (!lang) return null;
  await ensureInit();
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}
