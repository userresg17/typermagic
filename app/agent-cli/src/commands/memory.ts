// app/agent-cli/src/commands/memory.ts
// Memória v2 no terminal. `memory` (ou `memory graph`) imprime o grafo de notas como
// adjacência; `memory recall <consulta>` roda o recall híbrido. A graph view visual é
// no editor; aqui é a mesma store, em ASCII.

import { openMemory, pickEngineEmbedder } from "@typer/engine";
import { rootOf, type Flags } from "../config.js";
import { dim, bold, green } from "../render.js";

export async function memoryCmd(flags: Flags): Promise<number> {
  const [sub, ...rest] = flags.rest;
  const { embedder } = await pickEngineEmbedder(flags.local);
  const mem = await openMemory(rootOf(), embedder);

  if (sub === "recall") {
    const q = rest.join(" ").trim();
    if (!q) {
      console.error("uso: memory recall <consulta>");
      return 2;
    }
    const hits = await mem.recall(q, 8);
    if (hits.length === 0) {
      console.log(dim("· nenhuma entrada relevante"));
      return 0;
    }
    for (const h of hits) {
      const mark = h.verified ? green("✓") : " ";
      console.log(`${mark} ${dim(h.kind)} ${h.title ?? h.text.replace(/\n+/g, " ").slice(0, 70)}`);
    }
    return 0;
  }

  // graph (ascii)
  const g = mem.graphView();
  console.log(bold(`Grafo de memória: ${g.stats.notes} notas · ${g.stats.links} links · ${g.stats.dangling} fantasma`));
  const titleById = new Map(g.nodes.map((n) => [n.id, n.title]));
  for (const n of g.nodes.sort((a, b) => b.degree - a.degree)) {
    const outs = g.edges
      .filter((e) => e.source === n.id)
      .map((e) => titleById.get(e.target) ?? e.target);
    const tags = n.tags.length ? dim(" " + n.tags.map((t) => `#${t}`).join(" ")) : "";
    console.log(
      `• ${n.title} ${dim(`[${n.kind} deg=${n.degree}]`)}${tags}${outs.length ? " → " + outs.join(", ") : ""}`,
    );
  }
  return 0;
}
