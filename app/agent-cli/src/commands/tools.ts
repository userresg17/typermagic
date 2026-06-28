// app/agent-cli/src/commands/tools.ts
// Inspeção da camada de 50 ferramentas do agente. `tools` lista por família; `tools
// search <q>` filtra por nome/descrição/família. Mostra permissão e contexto de exec
// — a base do broker de capacidade.

import { ALL_TOOLS, type Tool } from "@typer/agent";
import { dim, bold } from "../render.js";
import type { Flags } from "../config.js";

function printGrouped(tools: Tool[]): void {
  const byFamily = new Map<string, Tool[]>();
  for (const t of tools) {
    if (!byFamily.has(t.family)) byFamily.set(t.family, []);
    byFamily.get(t.family)!.push(t);
  }
  for (const [family, fts] of [...byFamily.entries()].sort()) {
    console.log(bold(`\n${family}`));
    for (const t of fts.sort((a, b) => a.name.localeCompare(b.name))) {
      const flags = `${t.permission}/${t.exec}${t.sealGated ? "/selo" : ""}${t.requiresApproval ? "/aprovação" : ""}`;
      console.log(`  ${t.name.padEnd(20)} ${dim(`[${flags}]`)} ${t.description}`);
    }
  }
  console.log(dim(`\n${tools.length} ferramenta(s).`));
}

export function toolsCmd(flags: Flags): number {
  const [sub, ...rest] = flags.rest;
  if (sub === "search") {
    const q = rest.join(" ").toLowerCase();
    const hits = ALL_TOOLS.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.family.toLowerCase().includes(q),
    );
    printGrouped(hits);
    return 0;
  }
  printGrouped(ALL_TOOLS);
  return 0;
}
