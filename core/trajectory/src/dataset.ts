// core/trajectory/dataset.ts
// Trajetória → dataset, reusando o pipeline de @typer/finetune (Sample/splitDataset/
// toOpenAiJsonl). Cada trajetória vira uma amostra: o prompt como entrada, e o
// resumo dos passos + desfecho como completion. É a paridade com o export-para-treino
// do Hermes, com a diferença de que a trajetória sai assinada e verificável.

import { type Sample, type Dataset, splitDataset, toOpenAiJsonl, toGenericJsonl } from "@typer/finetune";
import { loadTrajectories } from "./recorder.js";
import type { Trajectory, TrajectoryStep } from "./types.js";

export const collectFromTrajectories = loadTrajectories;

function stepLine(s: TrajectoryStep): string {
  if (s.type === "tool.call") return `tool ${String(s.data.name)}(${JSON.stringify(s.data.args)})`;
  if (s.type === "tool.result") return `result ${String(s.data.name)} ok=${String(s.data.ok)}`;
  if (s.type === "seal") return `seal ${String(s.data.state)}`;
  if (s.type === "policy") return `policy ${String(s.data.decision)} ${String(s.data.tool)}`;
  if (s.type === "approval") return `approval`;
  return "";
}

/** Cada trajetória → uma amostra (prompt → passos + desfecho). */
export function trajectoriesToSamples(trajs: Trajectory[]): Sample[] {
  return trajs.map((t) => ({
    prompt: t.prompt,
    completion: [
      ...t.steps.map(stepLine).filter(Boolean),
      `outcome: ${JSON.stringify(t.outcome)}`,
    ].join("\n"),
  }));
}

/** Dataset (train/val) a partir das trajetórias. */
export function trajectoriesToDataset(trajs: Trajectory[], valFrac = 0.2): Dataset {
  return splitDataset(trajectoriesToSamples(trajs), valFrac);
}

export { toOpenAiJsonl, toGenericJsonl };
export type { Sample, Dataset };
