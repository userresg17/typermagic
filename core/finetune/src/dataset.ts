// core/finetune/dataset.ts
// Monta o dataset de next-edit a partir das sequências: cada amostra é
// (janela de edições anteriores → próxima edição). Formatos: OpenAI fine-tune
// (chat) e genérico {prompt,completion}. Puro e testável.

import type { EditEntry } from "./collect.js";

export interface Sample {
  prompt: string;
  completion: string;
}
export interface Dataset {
  train: Sample[];
  val: Sample[];
}

export const FINETUNE_SYSTEM =
  "Você prevê a próxima edição de código que o programador fará, no estilo deste projeto.";

function oneLine(s: string, max = 300): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** (janela de edições anteriores) → (próxima edição). */
export function buildSamples(entries: EditEntry[], window = 4): Sample[] {
  const samples: Sample[] = [];
  for (let i = 1; i < entries.length; i++) {
    const cur = entries[i];
    if (!cur || !cur.after.trim()) continue;
    const prior = entries.slice(Math.max(0, i - window), i);
    const prompt =
      "Edições recentes:\n" +
      prior.map((e) => `- ${e.file}: ${oneLine(e.after, 120)}`).join("\n") +
      `\n\nPróxima edição em ${cur.file}:`;
    samples.push({ prompt, completion: cur.after });
  }
  return samples;
}

export function splitDataset(samples: Sample[], valFrac = 0.2): Dataset {
  const n = samples.length;
  const valN = Math.min(n, Math.floor(n * valFrac));
  return { train: samples.slice(0, n - valN), val: samples.slice(n - valN) };
}

/** Formato de fine-tune do OpenAI (uma conversa por linha). */
export function toOpenAiJsonl(samples: Sample[], system = FINETUNE_SYSTEM): string {
  return samples
    .map((s) =>
      JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: s.prompt },
          { role: "assistant", content: s.completion },
        ],
      }),
    )
    .join("\n");
}

/** Formato genérico {prompt,completion} (LoRA/outros trainers). */
export function toGenericJsonl(samples: Sample[]): string {
  return samples.map((s) => JSON.stringify(s)).join("\n");
}
