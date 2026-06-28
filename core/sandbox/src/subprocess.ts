// core/sandbox/subprocess.ts
// Sandbox real por subprocess — o default, roda em qualquer lugar (inclusive no CI
// cross-OS). Isolamento em camadas, do mais forte disponível para o mais fraco:
//   1. bubblewrap (bwrap): FS read-only, workdir isolado, sem rede, sem pid/ipc/uts,
//      env limpo (--clearenv). É um sandbox de verdade.
//   2. unshare -rn: nova net namespace (sem rede) num user namespace.
//   3. plano: env limpo + cwd-jail + timeout (sem isolamento de rede garantido).
// Em todos: env limpo (sem segredos), workdir efêmero, teto de tempo. Código não
// confiável não recebe rede por padrão.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { detectIsolation, type Isolation } from "./detect.js";
import type { Sandbox, SandboxOptions, RunResult } from "./types.js";

const MAX_OUT = 100_000;

interface Entrypoint {
  file: string;
  cmd: string;
  args: string[];
}

function entrypoint(lang: string): Entrypoint {
  const l = (lang || "").toLowerCase();
  if (l === "js" || l === "javascript" || l === "node" || l === "mjs") {
    // node por caminho absoluto → não depende de PATH dentro do sandbox
    return { file: "main.mjs", cmd: process.execPath, args: ["main.mjs"] };
  }
  if (l === "py" || l === "python" || l === "python3") {
    return { file: "main.py", cmd: "python3", args: ["main.py"] };
  }
  if (l === "" || l === "auto" || l === "sh" || l === "bash") {
    return { file: "main.sh", cmd: "bash", args: ["main.sh"] };
  }
  throw new Error(`linguagem não suportada no sandbox: ${lang}`);
}

function cleanEnv(work: string): Record<string, string> {
  // env construído do zero: nada de TYPER_*_KEY, AWS_*, tokens. Só o mínimo.
  const nodeDir = dirname(process.execPath);
  return {
    PATH: `${nodeDir}:/usr/bin:/bin`,
    HOME: work,
    TMPDIR: work,
    LANG: "C.UTF-8",
  };
}

function bwrapArgs(work: string, allowNetwork: boolean): string[] {
  // Bind dos diretórios de SISTEMA read-only (não "/", senão não dá p/ criar /work).
  // O root do sandbox é um tmpfs; bwrap cria /work, /proc, /dev, /tmp.
  const nodeDir = dirname(process.execPath);
  const roPaths = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"];
  const a: string[] = [];
  for (const p of roPaths) if (existsSync(p)) a.push("--ro-bind", p, p);
  // garante o binário do node se estiver fora de /usr (nvm/fnm)
  if (!roPaths.some((p) => nodeDir.startsWith(p)) && existsSync(nodeDir)) {
    a.push("--ro-bind", nodeDir, nodeDir);
  }
  a.push(
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--bind", work, "/work",
    "--chdir", "/work",
    "--unshare-pid", "--unshare-uts", "--unshare-ipc",
    "--die-with-parent",
    "--clearenv",
    "--setenv", "PATH", `${nodeDir}:/usr/bin:/bin`,
    "--setenv", "HOME", "/work",
    "--setenv", "TMPDIR", "/tmp",
    "--setenv", "LANG", "C.UTF-8",
  );
  if (!allowNetwork) a.push("--unshare-net");
  a.push("--");
  return a;
}

function invocation(
  ep: Entrypoint,
  work: string,
  iso: Isolation,
  allowNetwork: boolean,
): { bin: string; argv: string[]; level: string } {
  if (iso.bwrap) {
    return { bin: "bwrap", argv: [...bwrapArgs(work, allowNetwork), ep.cmd, ...ep.args], level: "bwrap" };
  }
  if (iso.unshareNet && !allowNetwork) {
    return { bin: "unshare", argv: ["-rn", ep.cmd, ...ep.args], level: "unshare-net" };
  }
  return { bin: ep.cmd, argv: ep.args, level: allowNetwork ? "subprocess+net" : "subprocess" };
}

function spawnCapture(
  bin: string,
  argv: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
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
  });
}

export class SubprocessSandbox implements Sandbox {
  private readonly iso: Isolation;
  readonly level: string;

  constructor(private readonly opts: SandboxOptions = {}, iso?: Isolation) {
    this.iso = iso ?? detectIsolation();
    this.level = this.iso.bwrap ? "bwrap" : this.iso.unshareNet ? "unshare-net" : "subprocess";
  }

  async run(code: string, lang: string): Promise<string> {
    const ep = entrypoint(lang); // lança em linguagem não suportada (antes de criar nada)
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const allowNetwork = this.opts.allowNetwork ?? false;
    const work = await mkdtemp(join(tmpdir(), "typer-sbx-"));
    try {
      await writeFile(join(work, ep.file), code, "utf8");
      const inv = invocation(ep, work, this.iso, allowNetwork);
      const r = await spawnCapture(inv.bin, inv.argv, { cwd: work, env: cleanEnv(work), timeoutMs });
      if (r.timedOut) return "[sandbox] tempo limite excedido";
      let out = r.stdout;
      if (r.stderr.trim()) out += (out ? "\n" : "") + "[stderr] " + r.stderr.trim();
      if (r.code !== 0 && !out) out = `[sandbox] processo saiu com código ${r.code}`;
      return out;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  async snapshot(_id: string): Promise<string> {
    throw new Error("sandbox por subprocess é efêmero: sem snapshot (use o driver Firecracker)");
  }

  async restore(_snapshot: string): Promise<void> {
    throw new Error("sandbox por subprocess é efêmero: sem restore (use o driver Firecracker)");
  }
}
