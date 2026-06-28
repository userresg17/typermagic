// core/seal/runner.ts
// Roda o comando de teste do projeto e devolve o veredito cru. O comando vem
// do usuário e varia muito (pnpm test, pytest, cargo test...), então aceita
// string (via shell, para pipes e &&) ou argv (direto, determinístico p/ teste).

import { spawn } from "node:child_process";

export interface TestRunResult {
  code: number;
  output: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT = 5 * 60_000;

export function runTests(
  root: string,
  command: string | string[],
  opts: { timeoutMs?: number } = {},
): Promise<TestRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  return new Promise((resolve) => {
    const child = Array.isArray(command)
      ? spawn(command[0]!, command.slice(1), { cwd: root })
      : spawn(command, { cwd: root, shell: true });

    let output = "";
    let timedOut = false;
    const cap = (b: Buffer) => {
      output += b.toString("utf8");
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        output: `Falha ao iniciar o comando de teste: ${err.message}`,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output, timedOut });
    });
  });
}
