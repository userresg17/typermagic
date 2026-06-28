// core/finetune/ollama.ts
// Backend Ollama: gera um Modelfile que ASSA o SYSTEM + few-shot do projeto sobre
// um modelo-base de código. NÃO é treino de pesos (isso exige LoRA/GPU) — é uma
// adaptação leve, instantânea e local, usável já. O JSONL (dataset.ts) é o caminho
// pro fine-tune de verdade (OpenAI API ou um trainer LoRA externo).

import type { Sample } from "./dataset.js";
import { FINETUNE_SYSTEM } from "./dataset.js";

function oneLine(s: string, max = 400): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Modelfile do Ollama: FROM base + SYSTEM + few-shot (MESSAGE user/assistant). */
export function buildModelfile(base: string, examples: Sample[]): string {
  const lines = [`FROM ${base}`, `SYSTEM """${FINETUNE_SYSTEM}"""`];
  for (const e of examples.slice(0, 10)) {
    lines.push(`MESSAGE user """${oneLine(e.prompt)}"""`);
    lines.push(`MESSAGE assistant """${oneLine(e.completion)}"""`);
  }
  return lines.join("\n") + "\n";
}
