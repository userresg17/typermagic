// core/skills/index.ts — superfície pública do pacote @typer/skills

export type {
  Skill,
  CompletedTask,
  SkillStore,
  CapabilityManifest,
  SkillPermission,
  SkillExec,
} from "./types.js";
export { VerifiedSkillStore } from "./store.js";
export type { VerifiedSkillStoreOptions } from "./store.js";
export { serializeSkill, parseSkill } from "./skill-md.js";
export { signSkill, verifySkill, skillHash } from "./signing.js";
export { capabilityDiff, effectiveGrant, type CapabilityDiff, type GrantLike } from "./registry.js";
