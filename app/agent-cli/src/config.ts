// app/agent-cli/src/config.ts
// Parse de flags globais (compartilhadas pelos comandos) e montagem da EngineConfig.
// As mesmas flags da CLI antiga, agora opções da Engine.

import type { EngineConfig, EngineFeatures, SurfaceId } from "@typer/engine";
import type { ModeName, ApprovalPolicy } from "@typer/agent";

export interface Flags {
  files: string[];
  grep: boolean;
  semantic: boolean;
  memory: boolean;
  handoff: boolean;
  skills: boolean;
  mcp: boolean;
  consolidate: boolean;
  mode: string | null;
  approval: string | null;
  yes: boolean;
  test: string | null;
  attempts: number;
  model: string | null;
  provider: string | null;
  local: boolean;
  record: boolean;
  rest: string[];
}

export function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    files: [],
    grep: true,
    semantic: false,
    memory: false,
    handoff: false,
    skills: false,
    mcp: false,
    consolidate: false,
    mode: null,
    approval: null,
    yes: false,
    test: null,
    attempts: 2,
    model: null,
    provider: null,
    local: false,
    record: false,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--file" || a === "-f") {
      const n = argv[++i];
      if (n) f.files.push(n);
    } else if (a === "--test" || a === "-t") f.test = argv[++i] ?? null;
    else if (a === "--attempts") f.attempts = Math.max(1, Number(argv[++i]) || 2);
    else if (a === "--model" || a === "-m") f.model = argv[++i] ?? null;
    else if (a === "--provider" || a === "-p") f.provider = argv[++i] ?? null;
    else if (a === "--mode") f.mode = argv[++i] ?? null;
    else if (a === "--approval") f.approval = argv[++i] ?? null;
    else if (a === "--no-grep") f.grep = false;
    else if (a === "--semantic") f.semantic = true;
    else if (a === "--memory") f.memory = true;
    else if (a === "--handoff") f.handoff = true;
    else if (a === "--skills") f.skills = true;
    else if (a === "--mcp") f.mcp = true;
    else if (a === "--consolidate") f.consolidate = true;
    else if (a === "--local") f.local = true;
    else if (a === "--record") f.record = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else f.rest.push(a);
  }
  return f;
}

export function rootOf(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

const FEATURES = (f: Flags): EngineFeatures => ({
  semantic: f.semantic,
  memory: f.memory,
  handoff: f.handoff,
  skills: f.skills,
  mcp: f.mcp,
  consolidate: f.consolidate,
});

/** Monta a EngineConfig a partir das flags. `mode` força o modo do comando. */
export function buildEngineConfig(f: Flags, mode: ModeName, surface: SurfaceId = "tui"): EngineConfig {
  return {
    root: rootOf(),
    surface,
    provider: f.provider,
    local: f.local,
    model: f.model,
    mode,
    approval: (f.approval as ApprovalPolicy | null) ?? "first-only",
    grep: f.grep,
    attempts: f.attempts,
    ...(f.test ? { testCommand: f.test } : {}),
    ...(f.record ? { record: true } : {}),
    features: FEATURES(f),
  };
}
