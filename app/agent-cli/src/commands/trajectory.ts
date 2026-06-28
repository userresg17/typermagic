// app/agent-cli/src/commands/trajectory.ts
// trajectory list | verify | export. As trajetórias são gravadas quando uma tarefa
// roda com --record (.typer/trajectories/<id>.json, assinadas). `verify` confere a
// assinatura com a identidade local; `export` gera o dataset OpenAI p/ treino.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadTrajectories,
  verifyTrajectory,
  trajectoriesToDataset,
  toOpenAiJsonl,
  trajectoriesDir,
} from "@typer/trajectory";
import { loadOrCreateIdentity } from "@typer/crypto";
import { rootOf, type Flags } from "../config.js";
import { dim, green, red } from "../render.js";

export async function trajectoryCmd(flags: Flags): Promise<number> {
  const sub = flags.rest[0] ?? "list";
  const root = rootOf();
  const trajs = await loadTrajectories(root);

  if (sub === "list") {
    if (trajs.length === 0) {
      console.log(dim("· nenhuma trajetória (rode uma tarefa com --record)"));
      return 0;
    }
    for (const t of trajs) {
      console.log(
        `• ${t.id}  ${t.steps.length} passo(s)  ${dim(JSON.stringify(t.outcome))}  ${t.prompt.replace(/\n+/g, " ").slice(0, 40)}`,
      );
    }
    return 0;
  }

  if (sub === "verify") {
    const id = await loadOrCreateIdentity(join(root, ".typer", "identity"));
    let ok = 0;
    for (const t of trajs) {
      const v = verifyTrajectory(t, id.publicKeyPem);
      console.log(`${v ? green("✓") : red("✗")} ${t.id}`);
      if (v) ok++;
    }
    console.log(dim(`· ${ok}/${trajs.length} verificada(s)`));
    return ok === trajs.length ? 0 : 1;
  }

  if (sub === "export") {
    if (trajs.length === 0) {
      console.log(dim("· nada a exportar"));
      return 0;
    }
    const ds = trajectoriesToDataset(trajs, 0.2);
    const out = join(trajectoriesDir(root), "train.openai.jsonl");
    await writeFile(out, toOpenAiJsonl(ds.train), "utf8");
    console.log(green("✓") + ` ${ds.train.length} amostra(s) de treino → ${out}`);
    return 0;
  }

  console.error(red("uso: trajectory list | verify | export"));
  return 2;
}
