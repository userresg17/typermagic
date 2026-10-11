// core/agent/platform/linux.ts
// Implementação Linux (X11) da Platform via xdotool + captura por `import`/`scrot`/`gnome-screenshot`.
// Mantida p/ a máquina Linux original; sem jitter/humanização (cliques diretos). Não testada
// nesta máquina (macOS) — best-effort.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Platform, Screenshot, ScreenSize } from "./types.js";

function bin(...cands: string[]): string | null {
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

function xdo(args: string[]): string {
  const b = bin("/usr/bin/xdotool", "/usr/local/bin/xdotool");
  if (!b) throw new Error("xdotool não instalado (apt install xdotool)");
  const r = spawnSync(b, args, { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) throw new Error(`xdotool ${args[0]} falhou: ${r.stderr}`);
  return r.stdout;
}

export class LinuxPlatform implements Platform {
  readonly name = "linux" as const;
  async get_screen_size(): Promise<ScreenSize> {
    const out = xdo(["getdisplaygeometry"]);
    const [w, h] = out.trim().split(/\s+/).map(Number);
    return { width: w ?? 0, height: h ?? 0, scale: 1 };
  }
  async screenshot(): Promise<Screenshot> {
    const path = join(tmpdir(), `typer-shot-${process.pid}-${Date.now()}.png`);
    const tool = bin("/usr/bin/import", "/usr/bin/scrot", "/usr/bin/gnome-screenshot");
    if (!tool) throw new Error("sem ferramenta de captura (instale imagemagick ou scrot)");
    const args = tool.endsWith("import") ? ["-window", "root", path] : tool.endsWith("scrot") ? [path] : ["-f", path];
    const r = spawnSync(tool, args, { timeout: 15_000 });
    if (r.status !== 0) throw new Error("captura de tela falhou");
    const png = readFileSync(path);
    unlinkSync(path);
    const size = await this.get_screen_size();
    return { png_base64: png.toString("base64"), width: size.width, height: size.height, scale: 1, backend: tool };
  }
  async click(x: number, y: number, button: "left" | "right" = "left"): Promise<void> {
    xdo(["mousemove", String(Math.round(x)), String(Math.round(y)), "click", button === "right" ? "3" : "1"]);
  }
  async double_click(x: number, y: number): Promise<void> {
    xdo(["mousemove", String(Math.round(x)), String(Math.round(y)), "click", "--repeat", "2", "1"]);
  }
  async type(text: string): Promise<void> {
    xdo(["type", "--delay", "10", "--", text]);
  }
  async key(combo: string): Promise<void> {
    xdo(["key", combo.replace(/cmd|command|meta/gi, "super")]);
  }
  async scroll(x: number, y: number, dy: number): Promise<void> {
    const n = Math.max(1, Math.round(Math.abs(dy) / 100));
    xdo(["mousemove", String(Math.round(x)), String(Math.round(y)), "click", "--repeat", String(n), dy > 0 ? "4" : "5"]);
  }
  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    xdo(["mousemove", String(Math.round(x1)), String(Math.round(y1)), "mousedown", "1", "mousemove", String(Math.round(x2)), String(Math.round(y2)), "mouseup", "1"]);
  }
  async mouse_move(x: number, y: number): Promise<void> {
    xdo(["mousemove", String(Math.round(x)), String(Math.round(y))]);
  }
  async mouse_location(): Promise<{ x: number; y: number }> {
    const out = xdo(["getmouselocation", "--shell"]);
    const mx = out.match(/X=(\d+)/);
    const my = out.match(/Y=(\d+)/);
    return { x: mx ? Number(mx[1]) : 0, y: my ? Number(my[1]) : 0 };
  }
  async close(): Promise<void> {}
}
