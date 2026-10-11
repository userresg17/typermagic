// core/agent/steplog.ts — log ESTRUTURADO (JSONL) de cada passo do agente (Fase 5):
// ação, alvo, hash do screenshot, resultado. Rotação por tamanho (TYPER_STEP_LOG_MAX_MB,
// mantém 5 gerações). Nunca grava conteúdo de página nem segredo — só metadados.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StepRecord {
  ts?: string;
  surface: string;
  task: string;
  agent: "browser" | "desktop" | "tool-loop" | "gateway";
  step: number;
  action: string;
  target?: string;
  screenshot_sha256?: string;
  result: string;
  extra?: Record<string, unknown>;
}

export function logPath(): string {
  const v = process.env.TYPER_STEP_LOG ?? join(homedir(), "Library", "Logs", "typermagic", "steps.jsonl");
  return v.startsWith("~") ? join(homedir(), v.slice(1)) : v;
}

export function sha256(b64: string): string {
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").slice(0, 16);
}

function rotate(path: string): void {
  const maxMb = Number(process.env.TYPER_STEP_LOG_MAX_MB ?? 20);
  try {
    if (!existsSync(path) || statSync(path).size < maxMb * 1024 * 1024) return;
  } catch {
    return;
  }
  for (let i = 4; i >= 1; i--) {
    const from = `${path}.${i}`;
    if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
  }
  renameSync(path, `${path}.1`);
}

export function logStep(rec: StepRecord): void {
  try {
    const p = logPath();
    mkdirSync(dirname(p), { recursive: true });
    rotate(p);
    appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
  } catch (e) {
    // log nunca derruba o fluxo do dinheiro/tarefa
    console.error(`[steplog] falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}
