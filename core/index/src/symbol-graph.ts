// core/index/symbol-graph.ts
// Grafo de símbolos: mapeia quem refere quem, no nível de arquivo. Uma aresta
// A → B existe quando A referencia um nome que B define. Dá um sinal de
// proximidade no grafo de dependências para a recuperação híbrida (3.5), ao
// lado do semântico (índice) e do texto (ripgrep).

import type { FileSymbols, SymbolDef } from "./symbols.js";

export interface RelatedFile {
  file: string;
  score: number;
}

export class SymbolGraph {
  /** nome → arquivos que o definem */
  private readonly defsByName = new Map<string, Set<string>>();
  /** arquivo → nomes que ele referencia */
  private readonly refsByFile = new Map<string, Set<string>>();
  /** arquivo → nomes que ele define (para remoção incremental) */
  private readonly defNamesByFile = new Map<string, Set<string>>();

  addFile(file: string, symbols: FileSymbols): void {
    this.removeFile(file);
    const defNames = new Set(symbols.defs.map((d: SymbolDef) => d.name));
    this.defNamesByFile.set(file, defNames);
    for (const name of defNames) {
      const set = this.defsByName.get(name) ?? new Set<string>();
      set.add(file);
      this.defsByName.set(name, set);
    }
    this.refsByFile.set(file, new Set(symbols.refs));
  }

  /** Remove um arquivo do grafo. Base da indexação incremental (3.4). */
  removeFile(file: string): void {
    const defNames = this.defNamesByFile.get(file);
    if (defNames) {
      for (const name of defNames) {
        const set = this.defsByName.get(name);
        if (set) {
          set.delete(file);
          if (set.size === 0) this.defsByName.delete(name);
        }
      }
      this.defNamesByFile.delete(file);
    }
    this.refsByFile.delete(file);
  }

  /** Arquivos que definem um nome. */
  definitionsOf(name: string): string[] {
    return [...(this.defsByName.get(name) ?? [])];
  }

  /** Vizinhos de saída: arquivos cujos símbolos `file` referencia. */
  neighbors(file: string): Set<string> {
    const out = new Set<string>();
    for (const name of this.refsByFile.get(file) ?? []) {
      for (const def of this.defsByName.get(name) ?? []) {
        if (def !== file) out.add(def);
      }
    }
    return out;
  }

  /** Arquivos relacionados por proximidade no grafo (BFS até depth). */
  related(file: string, k = 5, depth = 2): RelatedFile[] {
    const scores = new Map<string, number>();
    let frontier = new Set<string>([file]);
    const visited = new Set<string>([file]);
    for (let d = 1; d <= depth; d++) {
      const next = new Set<string>();
      for (const f of frontier) {
        for (const nb of this.neighbors(f)) {
          if (visited.has(nb)) continue;
          scores.set(nb, (scores.get(nb) ?? 0) + 1 / d);
          next.add(nb);
        }
      }
      for (const n of next) visited.add(n);
      frontier = next;
      if (frontier.size === 0) break;
    }
    return [...scores.entries()]
      .map(([f, score]) => ({ file: f, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  size(): number {
    return this.refsByFile.size;
  }
}
