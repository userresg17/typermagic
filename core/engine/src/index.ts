// core/engine/index.ts — superfície pública do pacote @typer/engine.
// A Engine API é a fachada estável que toda superfície consome. Reexporta também os
// blocos da espinha de segurança (capacidade, selo por classe de ação) e os helpers
// de feature, para a CLI/TUI e o server montarem sobre a mesma base.

export { createEngine } from "./engine.js";
export type {
  Engine,
  EngineConfig,
  EngineHost,
  EngineFeatures,
  TaskRequest,
  TaskOutcome,
  EngineEvent,
  PlanView,
  SurfaceId,
  CapabilityGrant,
} from "./types.js";

// Espinha de segurança
export {
  FULL_GRANT,
  READONLY_GRANT,
  defaultGrantFor,
  brokerAllows,
  type BrokerVerdict,
} from "./capability.js";
export { SealRouter, type ActionClass, type SealRouterOptions } from "./seal-router.js";
export {
  loadPolicy,
  isAutonomous,
  evaluateExternal,
  type Policy,
  type PolicyDecision,
} from "./policy.js";

// Helpers de feature (reusados por superfícies)
export {
  memoryDir,
  openMemory,
  recallSection,
  recordEpisode,
  makeSummarizer,
  maybeConsolidate,
  CONSOLIDATE_THRESHOLD,
} from "./memory.js";
export { skillsDir, openSkills, recallSkillsSection, induceAndSeal } from "./skills.js";
export { handoffPath, loadHandoff, rePrimeSection, updateHandoff } from "./handoff.js";
export {
  mcpConfigPath,
  loadMcpConfig,
  connectMcp,
  mcpToolsSection,
  mcpExecutor,
} from "./mcp.js";
export {
  pickEngineEmbedder,
  buildRipgrepContext,
  buildHybridContext,
  appendSection,
  prependSection,
  type ContextResult,
} from "./context.js";
export { buildEngineProvider, type ProviderBundle } from "./providers.js";
export { callRegistryTool, engineToolExecutor, type ToolCallDeps, type PolicyNotice } from "./tools.js";
export { EventQueue } from "./event-queue.js";
