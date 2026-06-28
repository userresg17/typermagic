// core/agent/tools/executors.ts
// Executores por contexto (AGENT_TOOLS.md §C). in_process = o dispatcher só chama
// o handler (sem código extra). subprocess = runSubprocess (toolchain do usuário:
// comando, git, teste). microvm = adaptador para código não confiável — não há
// microVM real no v1, então StubMicroVm recusa com erro claro (o dispatcher já
// barra microvm sem adaptador antes disso).

import { spawn } from "node:child_process";
import type { MicroVm } from "./types.js";

export interface SubprocessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT = 2 * 60_000;

/** Roda um comando do toolchain do usuário e devolve o resultado cru. */
export function runSubprocess(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SubprocessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

/** microVM ausente: recusa com erro claro. Trocável por um adaptador real. */
export class StubMicroVm implements MicroVm {
  private fail(): never {
    throw new Error("microVM não disponível neste ambiente (stub)");
  }
  run(): Promise<string> {
    return this.fail();
  }
  snapshot(): Promise<string> {
    return this.fail();
  }
  restore(): Promise<void> {
    return this.fail();
  }
}
