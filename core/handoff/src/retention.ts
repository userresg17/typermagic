// core/handoff/retention.ts
// As regras de retenção, em código. Tier 0 verbatim com priorização forçada no
// estouro; Tier 1 append-only; Tier 2 regerado; Tier 3 ponteiros podados por
// score. É o procedimento "preencher" do schema, determinístico.

import {
  HANDOFF_SCHEMA_VERSION,
  RETENTION_POLICY,
  type Decision,
  type Handoff,
  type Invariants,
  type PinnedRule,
  type Pointer,
  type WorkState,
} from "./handoff.schema.js";
import { tokensOf } from "./validate.js";

// Ordem de descarte na priorização forçada (menos prioritário primeiro).
// locale e activeGoal nunca saem (obrigatórios).
const DROP_ORDER: (keyof Invariants)[] = [
  "sectionOverlay",
  "namingConvention",
  "hardConstraints",
  "forbiddenErrors",
  "pinned",
];

/** Garante que o Tier 0 cabe no teto, descartando do menos prioritário. */
export function forcePrioritizeTier0(inv: Invariants): Invariants {
  const out: Invariants = {
    ...inv,
    hardConstraints: [...inv.hardConstraints],
    namingConvention: [...inv.namingConvention],
    forbiddenErrors: [...inv.forbiddenErrors],
    sectionOverlay: [...inv.sectionOverlay],
    pinned: [...inv.pinned],
  };
  const cap = RETENTION_POLICY[0].maxTokens;
  for (const key of DROP_ORDER) {
    while (tokensOf(out) > cap) {
      const arr = out[key] as unknown[];
      if (arr.length === 0) break;
      arr.pop(); // remove o item mais recente da camada menos prioritária
    }
    if (tokensOf(out) <= cap) break;
  }
  return out;
}

/** Promove uma regra para o Tier 0 em runtime (dedup por texto). */
export function promoteRule(
  inv: Invariants,
  text: string,
  source: PinnedRule["source"],
  at: string,
): Invariants {
  if (inv.pinned.some((p) => p.text === text)) return inv;
  return { ...inv, pinned: [...inv.pinned, { text, source, at }] };
}

/** Poda ponteiros pelo teto do Tier 3, descartando os de menor score. */
export function prunePointers(pointers: Pointer[]): Pointer[] {
  const cap = RETENTION_POLICY[3].maxTokens;
  const sorted = [...pointers].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const kept: Pointer[] = [];
  for (const p of sorted) {
    kept.push(p);
    if (tokensOf({ pointers: kept }) > cap) {
      kept.pop();
      break;
    }
  }
  return kept;
}

export interface FillInput {
  section: string;
  createdAt: string;
  /** invariantes base (do handoff anterior, copiados verbatim) */
  tier0: Invariants;
  /** decisões novas a anexar ao Tier 1 */
  newDecisions?: Decision[];
  /** estado de trabalho regerado (Tier 2) */
  workState: WorkState;
  /** ponteiros do Tier 3 */
  pointers?: Pointer[];
}

/**
 * Preenche um handoff a partir do anterior, seguindo as regras de retenção.
 * Tier 0 copiado e priorizado; Tier 1 anexado; Tier 2 regerado; Tier 3 podado.
 */
export function fillHandoff(prev: Handoff | null, input: FillInput): Handoff {
  const tier0 = forcePrioritizeTier0(input.tier0);
  const prevEntries = prev?.tier1.entries ?? [];
  const tier1 = { entries: [...prevEntries, ...(input.newDecisions ?? [])] };
  const tier3 = { pointers: prunePointers(input.pointers ?? []) };
  return {
    schema: HANDOFF_SCHEMA_VERSION,
    section: input.section,
    createdAt: input.createdAt,
    tier0,
    tier1,
    tier2: input.workState,
    tier3,
  };
}
