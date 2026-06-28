// core/sandbox/types.ts
// Contrato de isolamento. `Sandbox` é estruturalmente o MicroVm do @typer/agent
// (run/snapshot/restore) — assim um sandbox pode ser injetado em ToolDeps.microvm
// sem acoplar os pacotes. run() roda código não confiável isolado e devolve a saída.

export interface Sandbox {
  /** roda `code` na linguagem `lang` (js/python/bash) isolado; devolve a saída */
  run(code: string, lang: string): Promise<string>;
  /** captura o estado (só drivers com VM real: Firecracker) */
  snapshot(id: string): Promise<string>;
  /** restaura um snapshot (só drivers com VM real) */
  restore(snapshot: string): Promise<void>;
  /** rótulo do nível de isolamento efetivo (p/ auditoria/telemetria) */
  readonly level: string;
}

export interface SandboxOptions {
  /** teto de tempo (ms); default 10000 */
  timeoutMs?: number;
  /** permitir rede no sandbox (default false — código não confiável não tem rede) */
  allowNetwork?: boolean;
  /** teto de memória (MB) — aplicado pelos drivers Docker/Firecracker */
  memoryMb?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}
