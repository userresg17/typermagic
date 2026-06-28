// core/handoff/handoff.schema.ts
// Schema determinístico do handoff em camadas (HANDOFF_SCHEMA.md). A política de
// retenção é DADO, não código espalhado — é o "script do que salvar". A
// arquitetura decide o que é slot e como cada camada é retida; o modelo só
// preenche os slots, e por isso o invariante (idioma, convenção) não sofre drift.

export const HANDOFF_SCHEMA_VERSION = 1;

export type Tier = 0 | 1 | 2 | 3;
export type RetentionMode = "verbatim" | "append" | "regenerate" | "pointer";

export interface TierPolicy {
  tier: Tier;
  mode: RetentionMode;
  maxTokens: number;
  onOverflow: "force-prioritize" | "compress-oldest" | "drop-lowest-score";
}

export const RETENTION_POLICY: Record<Tier, TierPolicy> = {
  0: { tier: 0, mode: "verbatim", maxTokens: 1200, onOverflow: "force-prioritize" },
  1: { tier: 1, mode: "append", maxTokens: 2000, onOverflow: "compress-oldest" },
  2: { tier: 2, mode: "regenerate", maxTokens: 1500, onOverflow: "compress-oldest" },
  3: { tier: 3, mode: "pointer", maxTokens: 800, onOverflow: "drop-lowest-score" },
};

// Tier 0 — invariantes. Copiado verbatim todo ciclo, nunca resumido.
export interface Invariants {
  locale: string;
  hardConstraints: string[];
  namingConvention: string[];
  forbiddenErrors: string[];
  activeGoal: string;
  sectionOverlay: string[];
  pinned: PinnedRule[];
}

export interface PinnedRule {
  text: string;
  source: "user" | "agent";
  at: string; // ISO 8601
}

// Tier 1 — registro de decisões. Append-only.
export interface Decision {
  decision: string;
  rationale: string;
  at: string;
}

// Tier 2 — estado de trabalho. Regerado a cada ciclo.
export interface WorkState {
  done: string[];
  inProgress: string[];
  focus: string;
}

// Tier 3 — ponteiros. Link em vez de conteúdo.
export interface Pointer {
  kind: "file" | "symbol" | "memory" | "url";
  ref: string;
  note?: string;
  score?: number;
}

export interface Handoff {
  schema: number;
  section: string;
  createdAt: string;
  tier0: Invariants;
  tier1: { entries: Decision[] };
  tier2: WorkState;
  tier3: { pointers: Pointer[] };
}
