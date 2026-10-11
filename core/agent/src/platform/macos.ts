// core/agent/platform/macos.ts
// Implementação macOS da Platform: fala com o sidecar Python (platform/macos/server.py, pyobjc)
// por JSON-lines. Um processo por sessão; reinicia sozinho se morrer. Timeout por chamada.
// O sidecar devolve o screenshot JÁ reduzido p/ a resolução lógica e converte as coordenadas
// de volta p/ pontos do display — a conversão Retina vive num lugar só (geometry.py).

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AxTree, DesktopExtras, Platform, Screenshot, ScreenSize } from "./types.js";

export interface MacOSOptions {
  /** python do venv (default: $TYPER_PY ou <repo>/.venv/bin/python) */
  python?: string;
  /** raiz do repo (onde está platform/macos/server.py). Default: auto-descoberta */
  root?: string;
  /** largura lógica declarada ao modelo (default $TYPER_SCREEN_LOGICAL_WIDTH ou 1440) */
  logicalWidth?: number;
  /** "main" ou índice do display (default $TYPER_DISPLAY ou main) */
  display?: string;
  timeoutMs?: number;
}

/** sobe do dist/ até achar platform/macos/server.py (repo root). */
export function findRepoRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  if (process.env.TYPER_ROOT && existsSync(join(process.env.TYPER_ROOT, "platform", "macos", "server.py"))) {
    return process.env.TYPER_ROOT;
  }
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "platform", "macos", "server.py"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("não achei platform/macos/server.py — defina TYPER_ROOT com a raiz do repo");
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class MacOSPlatform implements Platform, DesktopExtras {
  readonly name = "macos" as const;
  private proc: ChildProcess | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private buf = "";
  private readonly root: string;
  private readonly python: string;
  private readonly timeoutMs: number;
  private readonly env: Record<string, string>;
  /** app que DEVE estar em foco p/ qualquer evento de entrada (rechecado no sidecar antes de postar).
   *  O agente de desktop define a cada passo; vazio = sem checagem (só testes). */
  expectApp = "";

  constructor(opts: MacOSOptions = {}) {
    this.root = opts.root ?? findRepoRoot();
    this.python = opts.python ?? process.env.TYPER_PY ?? join(this.root, ".venv", "bin", "python");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.env = {
      TYPER_DISPLAY: opts.display ?? process.env.TYPER_DISPLAY ?? "main",
      TYPER_SCREEN_LOGICAL_WIDTH: String(opts.logicalWidth ?? process.env.TYPER_SCREEN_LOGICAL_WIDTH ?? 1440),
      ...(process.env.TYPER_SCREENSHOT_BACKEND ? { TYPER_SCREENSHOT_BACKEND: process.env.TYPER_SCREENSHOT_BACKEND } : {}),
    };
  }

  private ensure(): ChildProcess {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return this.proc;
    if (!existsSync(this.python)) {
      throw new Error(`python do venv não existe em ${this.python} — rode: uv venv .venv && uv pip install ... (ver README_MACOS.md)`);
    }
    const p = spawn(this.python, ["-I", join(this.root, "platform", "macos", "server.py")], {
      cwd: this.root,
      env: { ...process.env, ...this.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (d: string) => this.onData(d));
    p.stderr!.on("data", (d: Buffer) => console.error(`[macos-sidecar] ${d.toString().trim().slice(0, 300)}`));
    p.on("exit", (code) => {
      for (const [, pd] of this.pending) {
        clearTimeout(pd.timer);
        pd.reject(new Error(`sidecar macOS saiu (código ${code})`));
      }
      this.pending.clear();
      this.proc = null;
    });
    this.proc = p;
    return p;
  }

  private onData(d: string): void {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; ready?: boolean };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.ready) continue;
      const pd = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!pd) continue;
      this.pending.delete(msg.id!);
      clearTimeout(pd.timer);
      if (msg.ok) pd.resolve(msg.result);
      else pd.reject(new Error(msg.error ?? "erro no sidecar"));
    }
  }

  private guard(): Record<string, string> {
    return this.expectApp ? { expect_app: this.expectApp } : {};
  }

  /** chamada RPC genérica (exposta p/ testes/diagnóstico). */
  call<T = unknown>(op: string, args: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<T> {
    const p = this.ensure();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sidecar macOS: timeout em ${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      p.stdin!.write(JSON.stringify({ id, op, ...args }) + "\n");
    });
  }

  screenshot(): Promise<Screenshot> {
    return this.call<Screenshot>("screenshot", {}, 20_000);
  }
  async click(x: number, y: number, button: "left" | "right" = "left"): Promise<void> {
    await this.call("click", { ...this.guard(),  x, y, button });
  }
  async double_click(x: number, y: number): Promise<void> {
    await this.call("double_click", { ...this.guard(),  x, y });
  }
  async type(text: string): Promise<void> {
    await this.call("type", { ...this.guard(),  text });
  }
  async key(combo: string): Promise<void> {
    await this.call("key", { ...this.guard(),  combo });
  }
  async scroll(x: number, y: number, dy: number, dx = 0): Promise<void> {
    await this.call("scroll", { ...this.guard(),  x, y, dy, dx });
  }
  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    await this.call("drag", { ...this.guard(),  x1, y1, x2, y2 });
  }
  async mouse_move(x: number, y: number): Promise<void> {
    await this.call("mouse_move", { ...this.guard(),  x, y });
  }
  mouse_location(): Promise<{ x: number; y: number }> {
    return this.call("mouse_location");
  }
  get_screen_size(): Promise<ScreenSize> {
    return this.call<ScreenSize>("screen_size");
  }
  frontmost_app(): Promise<{ name: string; localized?: string; pid: number; bundle: string }> {
    return this.call("frontmost");
  }
  async ax_tree(): Promise<AxTree> {
    const t = await this.call<AxTree & { nodes: Array<AxTree["nodes"][number]> }>("ax_tree");
    // posições vêm em PONTOS do SO: converte p/ lógico com a geometria atual
    const size = await this.get_screen_size();
    const g = await this.call<{ display_pt: [number, number]; origin_pt: [number, number] }>("screen_size");
    const f = size.width / g.display_pt[0];
    for (const n of t.nodes) {
      if (n.pos) n.pos = [Math.round((n.pos[0] - g.origin_pt[0]) * f), Math.round((n.pos[1] - g.origin_pt[1]) * f)];
      if (n.size) n.size = [Math.round(n.size[0] * f), Math.round(n.size[1] * f)];
    }
    return t;
  }
  async ax_act(id: number, action = "Press", value?: string): Promise<void> {
    await this.call("ax_act", { id, action, ...(value !== undefined ? { value } : {}) });
  }
  ax_center(id: number): Promise<{ x: number; y: number } | null> {
    return this.call("ax_center", { id });
  }
  async open_app(name: string): Promise<void> {
    await this.call("open_app", { name });
  }
  async focus_app(name: string): Promise<void> {
    await this.call("focus_app", { name });
  }
  async quit_app(name: string): Promise<void> {
    await this.call("quit_app", { name });
  }
  async run_jxa(source: string, args: string[] = []): Promise<string> {
    const r = await this.call<{ output: string }>("run_jxa", { source, args }, 60_000);
    return r.output;
  }
  tcc(): Promise<{ screen_recording: boolean; accessibility: boolean; binary: string; instructions: string[] }> {
    return this.call("tcc");
  }
  async close(): Promise<void> {
    const p = this.proc;
    this.proc = null;
    if (p && p.exitCode === null) {
      p.stdin?.end();
      setTimeout(() => p.kill("SIGKILL"), 1500).unref();
    }
  }
}
