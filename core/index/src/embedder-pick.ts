// core/index/embedder-pick.ts
// Escolhe o embedder independente do provider de chat (Anthropic não embeda).
// Compartilhado por CLI e pelo Typer Core Server (era duplicado na CLI).

import { FakeEmbedder, OpenAIEmbedder, OllamaEmbedder } from "./embedders.js";
import type { Embedder } from "./types.js";

export interface EmbedderChoice {
  embedder: Embedder;
  id: string;
  /** false = offline (FakeEmbedder), não custa nada */
  online: boolean;
}

export function pickEmbedder(opts: {
  hasOpenAI: boolean;
  local: boolean;
}): EmbedderChoice {
  if (opts.hasOpenAI && !opts.local) {
    return { embedder: new OpenAIEmbedder(), id: "openai", online: true };
  }
  if (opts.local) {
    return { embedder: new OllamaEmbedder(), id: "ollama", online: true };
  }
  return { embedder: new FakeEmbedder(), id: "fake", online: false };
}
