// core/finetune/agent.ts
// O agente de fine-tuning orquestra o pipeline: coleta → dataset → artefatos →
// (treino, backend plugável) → registro. O treino PESADO (OpenAI fine-tune / LoRA)
// é disparado pelo dono com infra própria; aqui preparamos tudo e, no backend
// Ollama, criamos o modelo adaptado localmente (sem GPU).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { collectFromRoot, collectFromGit } from "./collect.js";
import {
  buildSamples,
  splitDataset,
  toOpenAiJsonl,
  toGenericJsonl,
} from "./dataset.js";
import { buildModelfile } from "./ollama.js";

export type FineTuneBackend = "prepare" | "ollama" | "openai";

export interface FineTuneReport {
  entries: number;
  samples: number;
  train: number;
  val: number;
  artifacts: string[];
  ollamaModel?: string;
  note: string;
}

function runCmd(cmd: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function runFineTune(opts: {
  root: string;
  backend?: FineTuneBackend;
  base?: string;
  modelName?: string;
}): Promise<FineTuneReport> {
  const backend = opts.backend ?? "prepare";
  // dados: rastro de edição do editor (.typer/edits) + histórico git (real).
  const trail = await collectFromRoot(opts.root);
  const git = await collectFromGit(opts.root);
  const entries = [...trail, ...git];
  const samples = buildSamples(entries);
  const ds = splitDataset(samples);

  const dir = join(opts.root, ".typer", "finetune");
  await mkdir(dir, { recursive: true });
  const artifacts: string[] = [];
  await writeFile(join(dir, "train.openai.jsonl"), toOpenAiJsonl(ds.train));
  artifacts.push("train.openai.jsonl");
  await writeFile(join(dir, "train.jsonl"), toGenericJsonl(ds.train));
  artifacts.push("train.jsonl");
  await writeFile(join(dir, "val.jsonl"), toGenericJsonl(ds.val));
  artifacts.push("val.jsonl");
  const modelfile = buildModelfile(opts.base ?? "qwen2.5-coder", ds.train);
  await writeFile(join(dir, "Modelfile"), modelfile);
  artifacts.push("Modelfile");

  let ollamaModel: string | undefined;
  let note =
    "Artefatos prontos. Treino pesado (OpenAI fine-tune com train.openai.jsonl, ou " +
    "LoRA com train.jsonl) é disparado pelo dono com a infra dele.";

  if (backend === "ollama") {
    if (samples.length === 0) {
      note = "Sem amostras de edição ainda (use o editor pra acumular .typer/edits).";
    } else {
      const name = opts.modelName ?? "typer-nextedit";
      const ok = await runCmd(`ollama create ${name} -f ${join(dir, "Modelfile")}`, opts.root);
      if (ok) {
        ollamaModel = name;
        note = `Modelo Ollama '${name}' criado (adaptação por Modelfile, local). Aponte typer.model p/ ele.`;
      } else {
        note = "Ollama indisponível; artefatos prontos p/ rodar 'ollama create' depois.";
      }
    }
  }

  return {
    entries: entries.length,
    samples: samples.length,
    train: ds.train.length,
    val: ds.val.length,
    artifacts,
    ...(ollamaModel ? { ollamaModel } : {}),
    note,
  };
}
