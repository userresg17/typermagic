// core/memory/types.ts
// Tipos da memória. Dois tipos de entrada: episódica (eventos, decisões,
// correções, com carimbo de tempo) e semântica (fatos estáveis do projeto).
// Cada entrada carrega procedência e confiança, então a recuperação pode
// preferir o que é verificado (arquitetura, componente 4).

export type MemoryKind = "episodic" | "semantic";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  /** ISO 8601 */
  at: string;
  /** 0..1 — quão importante a entrada é para recuperação */
  importance: number;
  /** 0..1 — confiança; entrada verificada pelo selo tende a 1 */
  confidence: number;
  /** de onde veio: usuário, agente, handoff, selo... */
  source: string;
  /** passou pelo selo? herda o resultado da verificação */
  verified: boolean;
  // --- memória v2 (estilo Obsidian) — todos opcionais p/ compat com .md antigos ---
  /** rótulo humano p/ resolver [[Título]]; default = 1ª linha do texto */
  title?: string;
  /** tags normalizadas (sem '#'): merge de #inline + frontmatter tags: */
  tags?: string[];
  /** ids resolvidos dos [[ ]] do corpo (derivado pelo grafo; não no frontmatter) */
  links?: string[];
}

/** Dados para escrever uma entrada; o store completa id/at/defaults. */
export interface MemoryInput {
  text: string;
  importance?: number;
  confidence?: number;
  source?: string;
  verified?: boolean;
  /** sobrescreve o carimbo de tempo (ISO); default = agora, injetado pelo store */
  at?: string;
  /** rótulo humano (resolve [[Título]]) */
  title?: string;
  /** tags extras além das parseadas do texto */
  tags?: string[];
}

export interface MemoryStore {
  writeEpisode(e: MemoryInput): Promise<MemoryEntry | null>;
  writeSemantic(f: MemoryInput): Promise<MemoryEntry | null>;
  recall(query: string, k: number): Promise<MemoryEntry[]>;
}
