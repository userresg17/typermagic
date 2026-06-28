// app/agent-cli/src/commands/skills.ts
// Biblioteca de skills verificadas (seladas pelo selo). `skills` mostra o tamanho;
// `skills <consulta>` recupera as relevantes. Indução/selagem acontecem no loop do
// agente (não aqui — uma skill só entra se a tarefa que a gerou passou no selo).

import { openSkills, pickEngineEmbedder } from "@typer/engine";
import { rootOf, type Flags } from "../config.js";
import { dim } from "../render.js";

export async function skillsCmd(flags: Flags): Promise<number> {
  const q = flags.rest.join(" ").trim();
  const { embedder } = await pickEngineEmbedder(flags.local);
  const store = await openSkills(rootOf(), embedder);
  if (!q) {
    console.log(dim(`${store.size()} skill(s) verificada(s). Use: skills <consulta>`));
    return 0;
  }
  const hits = await store.retrieve(q, 5);
  if (hits.length === 0) {
    console.log(dim("· nenhuma skill relevante"));
    return 0;
  }
  for (const s of hits) console.log(`• ${s.name} — ${s.description.replace(/\n+/g, " ")}`);
  return 0;
}
