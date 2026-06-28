// core/handoff/validate.ts
// Validação dura: locale e activeGoal sempre presentes; Tier 0 nunca passa do
// teto. Quando chega perto, a priorização forçada decide o que fica.

import {
  HANDOFF_SCHEMA_VERSION,
  RETENTION_POLICY,
  type Handoff,
} from "./handoff.schema.js";

export function tokensOf(value: unknown): number {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(s.length / 4);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateHandoff(h: Handoff): ValidationResult {
  const errors: string[] = [];
  if (h.schema !== HANDOFF_SCHEMA_VERSION) errors.push("schema desatualizado");
  if (!h.tier0?.locale) errors.push("tier0.locale obrigatório");
  if (!h.tier0?.activeGoal) errors.push("tier0.activeGoal obrigatório");
  if (tokensOf(h.tier0) > RETENTION_POLICY[0].maxTokens) {
    errors.push("tier0 acima do teto, requer force-prioritize");
  }
  return { ok: errors.length === 0, errors };
}
