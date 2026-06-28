// core/index/embedders.ts
// Embedders por provider, atrás da interface Embedder. Local-first (Ollama) e
// nuvem (OpenAI), mais um Fake determinístico para teste. Fetch nativo, sem SDK.

import { loadKey } from "@typer/router";
import type { Embedder } from "./types.js";

// --- Ollama (local) ---
const OLLAMA_DEFAULT = "nomic-embed-text";
function ollamaUrl(): string {
  return (process.env.TYPER_OLLAMA_URL ?? "http://localhost:11434").replace(
    /\/$/,
    "",
  );
}

export class OllamaEmbedder implements Embedder {
  readonly id: string;
  constructor(private readonly model: string = OLLAMA_DEFAULT) {
    this.id = `ollama:${model}`;
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${ollamaUrl()}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`Ollama embed ${res.status}. ${d.slice(0, 200)}`);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }
}

// --- OpenAI (nuvem) ---
const OPENAI_DEFAULT = "text-embedding-3-small";

export class OpenAIEmbedder implements Embedder {
  readonly id: string;
  constructor(private readonly model: string = OPENAI_DEFAULT) {
    this.id = `openai:${model}`;
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const key = await loadKey("openai");
    if (!key) throw new Error("Sem chave OpenAI para embeddings.");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`OpenAI embed ${res.status}. ${d.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    return (data.data ?? []).map((d) => d.embedding);
  }
}

// --- Fake (teste/offline) ---
// Embedding determinístico por bag-of-tokens projetado em D dimensões. Mantém a
// propriedade útil: textos parecidos ficam próximos no cosseno.
export class FakeEmbedder implements Embedder {
  readonly id = "fake";
  constructor(private readonly dims = 64) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
  private embedOne(text: string): number[] {
    const v = new Array(this.dims).fill(0) as number[];
    for (const tok of text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
      const idx = Math.abs(h) % this.dims;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    return v;
  }
}
