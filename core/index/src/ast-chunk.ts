// core/index/ast-chunk.ts
// Chunking por símbolo/função via tree-sitter (subfase 3.2). Agrupa os nós de
// topo até um teto de linhas, e nunca corta uma declaração no meio: um nó maior
// que o teto vira um chunk inteiro, não é fatiado. Substitui o chunker por
// janela do 3.1 onde há gramática; o resto cai no fallback.

import type Parser from "web-tree-sitter";
import { parserFor } from "./languages.js";
import type { RawChunk } from "./chunk.js";

export interface AstChunkOptions {
  maxLines?: number;
}

function slice(lines: string[], startRow: number, endRow: number): RawChunk {
  return {
    startLine: startRow + 1,
    endLine: endRow + 1,
    text: lines.slice(startRow, endRow + 1).join("\n"),
  };
}

/** Agrupa nós de topo em chunks até maxLines; nó grande vira chunk próprio. */
function nodesToChunks(
  nodes: Parser.SyntaxNode[],
  lines: string[],
  maxLines: number,
): RawChunk[] {
  const chunks: RawChunk[] = [];
  let bufStart = -1;
  let bufEnd = -1;
  const flush = (): void => {
    if (bufStart < 0) return;
    const c = slice(lines, bufStart, bufEnd);
    if (c.text.trim()) chunks.push(c);
    bufStart = -1;
    bufEnd = -1;
  };

  for (const n of nodes) {
    const s = n.startPosition.row;
    const e = n.endPosition.row;
    if (bufStart < 0) {
      bufStart = s;
      bufEnd = e;
    } else if (e - bufStart + 1 > maxLines) {
      flush();
      bufStart = s;
      bufEnd = e;
    } else {
      bufEnd = e;
    }
  }
  flush();
  return chunks;
}

/** Chunking AST. Retorna null se não há gramática para o arquivo. */
export async function chunkAst(
  content: string,
  file: string,
  opts: AstChunkOptions = {},
): Promise<RawChunk[] | null> {
  const parser = await parserFor(file);
  if (!parser) return null;
  const maxLines = opts.maxLines ?? 80;
  const tree = parser.parse(content);
  const lines = content.split("\n");
  const top = tree.rootNode.namedChildren;
  if (top.length === 0) return [];
  return nodesToChunks(top, lines, maxLines);
}
