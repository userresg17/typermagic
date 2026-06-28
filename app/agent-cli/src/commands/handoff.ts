// app/agent-cli/src/commands/handoff.ts
// Âncora de handoff em camadas: imprime o texto re-primado (Tier 0 invariantes +
// Tier 2 estado), o mesmo que a Engine injeta no topo do contexto sob --handoff.

import { loadHandoff, rePrimeSection } from "@typer/engine";
import { rootOf, type Flags } from "../config.js";
import { dim } from "../render.js";

export async function handoffCmd(_flags: Flags): Promise<number> {
  const h = await loadHandoff(rootOf());
  if (!h) {
    console.log(dim("· sem handoff em .typer/handoff.json"));
    return 0;
  }
  console.log(rePrimeSection(h));
  return 0;
}
