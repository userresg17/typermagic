// core/handoff/index.ts — superfície pública do pacote @typer/handoff

export {
  HANDOFF_SCHEMA_VERSION,
  RETENTION_POLICY,
} from "./handoff.schema.js";
export type {
  Tier,
  RetentionMode,
  TierPolicy,
  Invariants,
  PinnedRule,
  Decision,
  WorkState,
  Pointer,
  Handoff,
} from "./handoff.schema.js";
export { validateHandoff, tokensOf } from "./validate.js";
export type { ValidationResult } from "./validate.js";
export { detectLocale, languageCanary } from "./canary.js";
export {
  forcePrioritizeTier0,
  promoteRule,
  prunePointers,
  fillHandoff,
} from "./retention.js";
export type { FillInput } from "./retention.js";
export { persistHandoff, rePrimeText } from "./persist.js";
export { migrateHandoff } from "./migrate.js";
