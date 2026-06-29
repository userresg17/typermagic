// core/agent/index.ts — superfície pública do pacote @typer/agent

export { runEditLoop } from "./loop.js";
export type {
  AttemptInfo,
  EditLoopOptions,
  EditLoopOutcome,
} from "./types.js";
export {
  MODES,
  MODE_NAMES,
  DEFAULT_MODE,
  isModeName,
  resolveMode,
} from "./modes.js";
export type { Mode, ModeName } from "./modes.js";
export {
  AuditTrail,
  ApprovalGate,
  APPROVAL_POLICIES,
  isApprovalPolicy,
} from "./hitl.js";
export type {
  AuditEntry,
  ApprovalPolicy,
  ApprovalRequest,
  Prompter,
} from "./hitl.js";
export { runToolLoop } from "./tool-loop.js";
export type {
  ToolExecutor,
  ToolLoopOptions,
  ToolLoopResult,
} from "./tool-loop.js";

// Camada de ferramentas (AGENT_TOOLS.md): registry das 50, dispatcher com
// política/selo/auditoria, e o adapter p/ o runToolLoop.
export {
  buildDefaultRegistry,
  DefaultToolRegistry,
  dispatch,
  registryExecutor,
  toolSpec,
  runSubprocess,
  StubMicroVm,
  ALL_TOOLS,
  nowIso,
  reachSkillSection,
  browserSkillSection,
  BROWSER_SKILL,
  openBrowser,
} from "./tools/index.js";
export type { BrowserOptions } from "./tools/index.js";
export type {
  Tool,
  ToolRegistry,
  ToolContext,
  ToolDeps,
  ToolResult,
  ToolParam,
  Permission,
  ExecContext,
  ExternalEffect,
  Tier,
  AuditEvent,
  MicroVm,
  BrowserSession,
} from "./tools/index.js";
