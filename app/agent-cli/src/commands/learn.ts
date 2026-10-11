// app/agent-cli/src/commands/learn.ts
// `learn <url> [--app "Nome"]`: aprende um procedimento de GUI assistindo um tutorial
// (Fase 7). Sai uma skill CANDIDATA em .typer/skills/<id>/SKILL.md — não entra no
// recall do agente até ser ensaiada e selada (Fase 8). `learn list` lista as skills;
// `learn show <id>` imprime o SKILL.md.

import { readFile } from "node:fs/promises";
import { learn, listSkills, readSkill, summarizeSkill, setupLearn } from "@typer/learn";
import { rootOf, type Flags } from "../config.js";
import { dim, bold } from "../render.js";

export async function learnCmd(flags: Flags): Promise<number> {
  const [first, ...more] = flags.rest;
  const root = rootOf();
  if (!first || first === "help") {
    console.log(
      [
        bold("learn") + " — aprende uma skill de GUI a partir de um tutorial em vídeo",
        "  learn <url> [--app Nome]   baixa, transcreve, descreve frames e destila a skill (candidata)",
        "  learn list                 lista skills (candidatas e seladas)",
        "  learn show <id>            imprime o SKILL.md",
        dim("  modelos: TYPER_LEARN_VISION_MODEL (frames) · TYPER_LEARN_MODEL (destilação) · pasta: TYPER_LEARN_DIR"),
      ].join("\n"),
    );
    return 0;
  }
  const setup = await setupLearn({ root, provider: flags.provider, model: flags.model, local: flags.local });

  if (first === "list") {
    const all = await listSkills(setup.skillsDir);
    if (all.length === 0) {
      console.log(dim("· nenhuma skill ainda. Use: learn <url>"));
      return 0;
    }
    for (const s of all) console.log(`• ${s.id} [${s.state ?? (s.sealed ? "sealed" : "legacy")}] — ${s.name}${s.app ? ` (${s.app})` : ""}`);
    return 0;
  }
  if (first === "show") {
    const id = more[0];
    const s = id ? await readSkill(setup.skillsDir, id) : null;
    if (!s) {
      console.error(`skill não encontrada: ${id ?? "(sem id)"}`);
      return 1;
    }
    console.log(await readFile(`${setup.skillsDir}/${s.id}/SKILL.md`, "utf8"));
    return 0;
  }

  // --app Nome  (a flag genérica não conhece --app; lemos do rest)
  let appHint: string | undefined;
  const i = more.indexOf("--app");
  if (i !== -1) appHint = more.slice(i + 1).join(" ").trim() || undefined;

  console.error(dim(`· provider=${setup.providerId} visão=${setup.visionModel} destilação=${setup.distillModel}`));
  const t0 = Date.now();
  try {
    const r = await learn(
      first,
      { workDir: setup.workDir, skillsDir: setup.skillsDir, visionModel: setup.visionModel, distillModel: setup.distillModel, appHint, onProgress: (m) => console.error(dim("· " + m)) },
      { provider: setup.provider },
    );
    const skill = await readSkill(setup.skillsDir, r.skillId);
    console.log("");
    console.log(skill ? summarizeSkill(skill) : r.skillId);
    console.log("");
    console.log(dim(`arquivo: ${r.skillPath}`));
    console.log(dim(`frames=${r.frames} trechos=${r.segments} tokens in/out=${r.usage.inputTokens}/${r.usage.outputTokens} tempo=${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(r.timings)}`));
    return 0;
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
