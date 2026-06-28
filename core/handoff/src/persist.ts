// core/handoff/persist.ts
// Clear e persistência: salva as decisões (Tier 1) e o estado (Tier 2) na
// memória como entradas episódicas indexadas. E o re-primar: o Tier 0 verbatim
// (âncora) + o Tier 2 atual, re-injetados depois do clear sem drift.

import type { MemoryStore } from "@typer/memory";
import type { Handoff } from "./handoff.schema.js";

/** Persiste o handoff na memória (decisões + estado). Devolve quantas entraram. */
export async function persistHandoff(
  h: Handoff,
  memory: MemoryStore,
): Promise<number> {
  let written = 0;
  for (const d of h.tier1.entries) {
    const e = await memory.writeEpisode({
      text: `Decisão: ${d.decision}. Motivo: ${d.rationale}`,
      at: d.at,
      source: "handoff",
      importance: 0.7,
    });
    if (e) written++;
  }
  const state = await memory.writeEpisode({
    text: `Seção ${h.section} — foco: ${h.tier2.focus}. Feito: ${h.tier2.done.join("; ")}. Em curso: ${h.tier2.inProgress.join("; ")}`,
    at: h.createdAt,
    source: "handoff",
    importance: 0.6,
  });
  if (state) written++;
  return written;
}

/** Texto de re-priming: Tier 0 verbatim + Tier 2. A âncora que segura o idioma
 *  e a convenção depois do clear. A fatia relevante entra por cima (3.5/3.6). */
export function rePrimeText(h: Handoff): string {
  const t0 = h.tier0;
  const parts: string[] = [
    "# Invariantes (Tier 0 — verbatim)",
    `Idioma: ${t0.locale}`,
    `Objetivo: ${t0.activeGoal}`,
  ];
  if (t0.hardConstraints.length)
    parts.push(`Restrições: ${t0.hardConstraints.join("; ")}`);
  if (t0.namingConvention.length)
    parts.push(`Convenções: ${t0.namingConvention.join("; ")}`);
  if (t0.forbiddenErrors.length)
    parts.push(`Erros que não podem acontecer: ${t0.forbiddenErrors.join("; ")}`);
  if (t0.sectionOverlay.length)
    parts.push(`Overlay da seção: ${t0.sectionOverlay.join("; ")}`);
  if (t0.pinned.length)
    parts.push(`Fixados: ${t0.pinned.map((p) => p.text).join("; ")}`);
  parts.push("\n# Estado de trabalho (Tier 2)");
  parts.push(`Foco: ${h.tier2.focus}`);
  if (h.tier2.inProgress.length)
    parts.push(`Em curso: ${h.tier2.inProgress.join("; ")}`);
  return parts.join("\n");
}
