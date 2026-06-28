// core/engine/skills.ts
// Indução de skill GATEADA pelo selo. Recall de skills verificadas no contexto; no
// Verificado do loop, destila uma skill da tarefa e só a guarda se o selo passou —
// o moat: biblioteca de procedimento verificado, não alucinação. Vault em
// <root>/.typer/skills. Portado de app/cli/src/skills.ts, sem logging.

import { join } from "node:path";
import { VerifiedSkillStore } from "@typer/skills";
import type { Embedder } from "@typer/index";
import type { SealResult } from "@typer/seal";

export function skillsDir(root: string): string {
  return join(root, ".typer", "skills");
}

export async function openSkills(root: string, embedder: Embedder): Promise<VerifiedSkillStore> {
  const store = new VerifiedSkillStore({ dir: skillsDir(root), embedder });
  await store.load();
  return store;
}

/** Skills verificadas relevantes p/ o contexto. Devolve a seção e a contagem. */
export async function recallSkillsSection(
  store: VerifiedSkillStore,
  task: string,
  k = 3,
): Promise<{ section: string; count: number }> {
  const hits = await store.retrieve(task, k);
  if (hits.length === 0) return { section: "", count: 0 };
  const lines = hits.map((s) => `- ${s.name}: ${s.description.replace(/\n+/g, " ")}`);
  return {
    section: ["## Skills aprendidas (verificadas pelo selo)", ...lines].join("\n"),
    count: hits.length,
  };
}

/** Destila uma skill da tarefa concluída e a sela (só guarda se Verificado).
 *  Devolve true se a skill entrou na biblioteca. */
export async function induceAndSeal(
  store: VerifiedSkillStore,
  opts: { task: string; result: SealResult },
): Promise<boolean> {
  const candidate = store.induce({
    name: opts.task.slice(0, 60),
    description: opts.task,
    methodology: `Tarefa resolvida e selada via edição SEARCH/REPLACE: ${opts.task}`,
    codeVersion: "0.0.0",
  });
  const sealed = await store.seal(candidate, opts.result);
  return !!sealed;
}
