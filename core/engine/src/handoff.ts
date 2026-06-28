// core/engine/handoff.ts
// Handoff em camadas. O valor é re-primar sem drift: a âncora (Tier 0 invariantes
// verbatim + Tier 2 estado) é re-injetada no TOPO do contexto a cada run, e cada
// sucesso anexa uma decisão (Tier 1) e regenera o estado (Tier 2), persistido em
// <root>/.typer/handoff.json (+ memória). Portado de app/cli/src/handoff.ts.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  fillHandoff,
  rePrimeText,
  migrateHandoff,
  persistHandoff,
  type Handoff,
  type Invariants,
  type WorkState,
} from "@typer/handoff";
import type { MemoryStore } from "@typer/memory";

export function handoffPath(root: string): string {
  return join(root, ".typer", "handoff.json");
}

/** Carrega e migra o handoff do disco, ou null se não existe/inválido. */
export async function loadHandoff(root: string): Promise<Handoff | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(handoffPath(root), "utf8"));
    return migrateHandoff(raw as Partial<Handoff> & { schema?: number });
  } catch {
    return null;
  }
}

/** Texto-âncora p/ re-injetar no contexto (Tier 0 + Tier 2), sem drift. */
export function rePrimeSection(h: Handoff): string {
  return rePrimeText(h);
}

function seedInvariants(goal: string): Invariants {
  return {
    locale: "pt-BR", // invariante do projeto
    hardConstraints: [],
    namingConvention: [],
    forbiddenErrors: [],
    activeGoal: goal,
    sectionOverlay: [],
    pinned: [],
  };
}

/** Anexa a tarefa concluída como decisão, regenera o estado e persiste. Devolve o
 *  handoff novo (com a contagem de decisões em next.tier1.entries). */
export async function updateHandoff(
  root: string,
  prev: Handoff | null,
  opts: { task: string; mem?: MemoryStore | null; section?: string },
): Promise<Handoff> {
  const at = new Date().toISOString();
  const tier0 = prev?.tier0 ?? seedInvariants(opts.task);
  const prevDone = prev?.tier2.done ?? [];
  const workState: WorkState = {
    focus: opts.task,
    done: [...prevDone, opts.task].slice(-20),
    inProgress: [],
  };
  const next = fillHandoff(prev, {
    section: prev?.section ?? opts.section ?? "engine",
    createdAt: at,
    tier0,
    newDecisions: [{ decision: opts.task, rationale: "concluído via Engine", at }],
    workState,
    pointers: prev?.tier3.pointers ?? [],
  });
  await mkdir(dirname(handoffPath(root)), { recursive: true });
  await writeFile(handoffPath(root), JSON.stringify(next, null, 2), "utf8");
  if (opts.mem) await persistHandoff(next, opts.mem);
  return next;
}
