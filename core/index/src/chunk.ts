// core/index/chunk.ts
// Chunker simples por janela de linhas, com sobreposição. É a forma crua do 3.1;
// o chunking por símbolo/função com tree-sitter substitui isto na subfase 3.2,
// atrás da mesma forma de saída.

export interface RawChunk {
  startLine: number; // 1-based
  endLine: number;
  text: string;
}

export interface ChunkOptions {
  maxLines?: number;
  overlap?: number;
}

export function chunkCode(content: string, opts: ChunkOptions = {}): RawChunk[] {
  const maxLines = opts.maxLines ?? 60;
  const overlap = Math.min(opts.overlap ?? 10, maxLines - 1);
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const chunks: RawChunk[] = [];
  const step = Math.max(1, maxLines - overlap);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + maxLines, lines.length);
    const text = lines.slice(start, end).join("\n");
    if (text.trim()) {
      chunks.push({ startLine: start + 1, endLine: end, text });
    }
    if (end >= lines.length) break;
  }
  return chunks;
}
