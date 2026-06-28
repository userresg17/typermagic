// core/agent/tools/executors.ts
// Executores por contexto (AGENT_TOOLS.md §C). in_process = o dispatcher só chama
// o handler (sem código extra). subprocess = runSubprocess (toolchain do usuário:
// comando, git, teste). microvm = adaptador para código não confiável — não há
// microVM real no v1, então StubMicroVm recusa com erro claro (o dispatcher já
// barra microvm sem adaptador antes disso).

import { spawn, type ChildProcess } from "node:child_process";
import type { MicroVm } from "./types.js";

export interface SubprocessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT = 2 * 60_000;

/** Coleta stdout/stderr/código de um processo já criado, com teto de tempo. */
function collect(child: ChildProcess, timeoutMs: number): Promise<SubprocessResult> {
  return new Promise((resolve) => {
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

/** Roda um comando do toolchain do usuário VIA SHELL e devolve o resultado cru.
 *  Use só para comando livre do usuário (run_command). Para binários estruturados
 *  (git, etc.) prefira runArgv — sem shell, sem quoting, cross-platform. */
export function runSubprocess(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SubprocessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const child = spawn(cmd, {
    shell: true,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return collect(child, timeoutMs);
}

/** Roda um binário com argv explícito, SEM shell — sem quoting e cross-platform
 *  (no Windows o cmd.exe não trata aspas simples como o /bin/sh). Também elimina
 *  a superfície de injeção de shell. */
export function runArgv(
  file: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SubprocessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const child = spawn(file, args, {
    shell: false,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return collect(child, timeoutMs);
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
