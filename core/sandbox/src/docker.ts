// core/sandbox/docker.ts
// Driver Docker — isolamento por container, real e forte. Usado quando o host tem
// Docker (o servidor de produção tem). Código vai por stdin (sem volume), sem rede
// por padrão (--network none), com teto de memória/cpu/pids. A imagem é puxada na
// 1ª execução. Não é exigido pelo CI cross-OS — o subprocess é o default.

import { spawn } from "node:child_process";
import type { Sandbox, SandboxOptions, RunResult } from "./types.js";

interface Plan {
  image: string;
  cmd: string[];
}

function plan(lang: string): Plan {
  const l = (lang || "").toLowerCase();
  if (l === "js" || l === "javascript" || l === "node" || l === "mjs") {
    return { image: "node:20-alpine", cmd: ["node", "--input-type=module", "-"] };
  }
  if (l === "py" || l === "python" || l === "python3") {
    return { image: "python:3-alpine", cmd: ["python3", "-"] };
  }
  if (l === "" || l === "auto" || l === "sh" || l === "bash") {
    return { image: "bash:5", cmd: ["bash", "-s"] };
  }
  throw new Error(`linguagem não suportada no sandbox: ${lang}`);
}

const MAX_OUT = 100_000;

function runDocker(args: string[], input: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args);
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

export class DockerSandbox implements Sandbox {
  readonly level = "docker";

  constructor(private readonly opts: SandboxOptions & { image?: string } = {}) {}

  async run(code: string, lang: string): Promise<string> {
    const p = plan(lang);
    const timeoutMs = this.opts.timeoutMs ?? 20_000;
    const mem = this.opts.memoryMb ?? 256;
    const net = this.opts.allowNetwork ? [] : ["--network", "none"];
    const args = [
      "run", "--rm", "-i",
      ...net,
      `--memory=${mem}m`,
      "--cpus=1",
      "--pids-limit=128",
      "--read-only",
      this.opts.image ?? p.image,
      ...p.cmd,
    ];
    const r = await runDocker(args, code, timeoutMs);
    if (r.timedOut) return "[sandbox] tempo limite excedido";
    let out = r.stdout;
    if (r.stderr.trim()) out += (out ? "\n" : "") + "[stderr] " + r.stderr.trim();
    if (r.code !== 0 && !out) out = `[sandbox] container saiu com código ${r.code}`;
    return out;
  }

  async snapshot(_id: string): Promise<string> {
    throw new Error("DockerSandbox: snapshot não suportado (use o driver Firecracker)");
  }

  async restore(_snapshot: string): Promise<void> {
    throw new Error("DockerSandbox: restore não suportado (use o driver Firecracker)");
  }
}
