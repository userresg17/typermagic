// core/engine/memory.ts
// Memória indexada na Engine. Recall antes (injeta a memória relevante no contexto)
// e grava um episódio no ponto exato de sucesso (Verificado no loop / aplicado no
// edit). Vault em <root>/.typer/memory. Embedder compartilhado com a recuperação.
// Portado de app/cli/src/memory.ts + consolidate.ts, sem logging (a Engine emite).

import { join } from "node:path";
import { MarkdownMemory } from "@typer/memory";
import type { Embedder } from "@typer/index";
import type { Provider } from "@typer/router";

export function memoryDir(root: string): string {
  return join(root, ".typer", "memory");
}

export async function openMemory(root: string, embedder: Embedder): Promise<MarkdownMemory> {
  const mem = new MarkdownMemory({ dir: memoryDir(root), embedder });
  await mem.load();
  return mem;
}

/** Memória relevante p/ o contexto. Devolve a seção e quantas entradas casaram. */
export async function recallSection(
  mem: MarkdownMemory,
  query: string,
  k = 5,
): Promise<{ section: string; count: number }> {
  const hits = await mem.recall(query, k);
  if (hits.length === 0) return { section: "", count: 0 };
  const lines = hits.map(
    (e) => `- ${e.verified ? "[verificado] " : ""}${e.text.replace(/\n+/g, " ")}`,
  );
  return { section: ["## Memória do projeto (relevante)", ...lines].join("\n"), count: hits.length };
}

/** Grava um episódio do que aconteceu (chamado no sucesso). */
export async function recordEpisode(
  mem: MarkdownMemory,
  opts: { task: string; detail: string; verified: boolean },
): Promise<void> {
  await mem.writeEpisode({
    text: `Tarefa: ${opts.task}\n${opts.detail}`,
    source: "engine",
    verified: opts.verified,
    // verificado pelo selo → confiança alta; aplicado sem teste → média
    importance: opts.verified ? 0.7 : 0.5,
    confidence: opts.verified ? 0.95 : 0.6,
  });
}

/** Acima deste tamanho do vault, a consolidação dispara sozinha após o sucesso. */
export const CONSOLIDATE_THRESHOLD = 8;

/** Summarizer p/ o consolidate: pede ao modelo UM fato estável dos episódios. */
export function makeSummarizer(
  provider: Provider,
  model: string,
): (texts: string[]) => Promise<string> {
  return async (texts) => {
    const lista = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
    let out = "";
    for await (const c of provider.chat({
      messages: [
        {
          role: "user",
          content:
            "Destile UM fato estável e reutilizável do projeto a partir destes " +
            "episódios. Responda só o fato, em pt-BR, em 1 frase:\n\n" +
            lista,
        },
      ],
      model,
      maxTokens: 200,
    })) {
      out += c.text;
    }
    return out.trim() || texts[0] || "";
  };
}

/** Gatilho: roda se forçado (consolidate) ou se o vault passou do limiar.
 *  Devolve quantos fatos foram destilados (0 = não rodou). */
export async function maybeConsolidate(
  mem: MarkdownMemory,
  provider: Provider,
  model: string,
  force: boolean,
): Promise<number> {
  if (!force && mem.size() < CONSOLIDATE_THRESHOLD) return 0;
  const facts = await mem.consolidate({ summarize: makeSummarizer(provider, model) });
  return facts.length;
}
