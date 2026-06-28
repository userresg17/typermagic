// core/sandbox/firecracker.ts
// Driver Firecracker — o isolamento mais forte (microVM com KVM), opt-in. A imagem
// de guest (kernel + rootfs com um agente que executa o código) é INFRA DO DONO: o
// dono fornece um launcher executável via TYPER_FC_RUN, que recebe a linguagem como
// argv[1] e o código por stdin, e devolve a saída por stdout (o launcher faz o boot
// da microVM com firecracker/jailer e o vsock). Acende só onde há /dev/kvm.
//
// Por que assim: bootar uma microVM exige um kernel e um rootfs versionados (como
// uma imagem Docker), que não cabem no repo nem rodam no CI. O contrato TYPER_FC_RUN
// torna a integração REAL e plugável sem fingir uma VM que não existe aqui.

import { spawn } from "node:child_process";
import { detectIsolation } from "./detect.js";
import type { Sandbox, SandboxOptions, RunResult } from "./types.js";

const MAX_OUT = 100_000;

function runLauncher(runner: string, lang: string, input: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(runner, [lang], { env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => {
      if (stdout.length < MAX_OUT) stdout += b.toString();
    });
    child.stderr?.on("data", (b: Buffer) => {
      if (stderr.length < MAX_OUT) stderr += b.toString();
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ stdout, stderr: stderr + String(e), code: -1, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, code: code ?? -1, timedOut });
    });
    child.stdin?.end(input);
  });
}

export class FirecrackerDriver implements Sandbox {
  readonly level = "firecracker";

  constructor(private readonly opts: SandboxOptions = {}) {}

  /** Disponível só com /dev/kvm + um launcher do dono (TYPER_FC_RUN). */
  available(): boolean {
    return detectIsolation().kvm && !!process.env.TYPER_FC_RUN;
  }

  async run(code: string, lang: string): Promise<string> {
    const runner = process.env.TYPER_FC_RUN;
    if (!detectIsolation().kvm) {
      throw new Error("Firecracker indisponível: /dev/kvm ausente (use o driver Docker ou subprocess)");
    }
    if (!runner) {
      throw new Error(
        "Firecracker requer um launcher do dono em TYPER_FC_RUN (kernel+rootfs do guest). " +
          "Sem ele, use TYPER_SANDBOX=docker ou o subprocess (default).",
      );
    }
    const r = await runLauncher(runner, lang, code, this.opts.timeoutMs ?? 30_000);
    if (r.timedOut) return "[sandbox] tempo limite excedido";
    let out = r.stdout;
    if (r.stderr.trim()) out += (out ? "\n" : "") + "[stderr] " + r.stderr.trim();
    return out;
  }

  async snapshot(id: string): Promise<string> {
    const runner = process.env.TYPER_FC_RUN;
    if (!runner) throw new Error("Firecracker snapshot requer TYPER_FC_RUN");
    const r = await runLauncher(runner, `snapshot:${id}`, "", this.opts.timeoutMs ?? 30_000);
    return r.stdout.trim();
  }

  async restore(snapshot: string): Promise<void> {
    const runner = process.env.TYPER_FC_RUN;
    if (!runner) throw new Error("Firecracker restore requer TYPER_FC_RUN");
    await runLauncher(runner, `restore:${snapshot}`, "", this.opts.timeoutMs ?? 30_000);
  }
}
