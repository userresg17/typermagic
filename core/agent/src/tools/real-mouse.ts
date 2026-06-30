// core/agent/tools/real-mouse.ts
// MOUSE REAL do sistema operacional (não o do navegador/CDP). Move o cursor FÍSICO na tela e
// dispara cliques/press-and-hold como entrada de hardware — indistinguível de humano p/ anti-bot,
// e visível na tela. Linux/Xwayland via `xdotool` (o Brave headful roda em Xwayland :0).
// Cross-platform (Windows/macOS via nut.js) fica como evolução; aqui cobre a máquina do usuário.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function xdotoolBin(): string | null {
  for (const p of ["/usr/bin/xdotool", "/usr/local/bin/xdotool"]) if (existsSync(p)) return p;
  return null;
}

/** dá p/ usar o mouse real? Precisa: opt-in (TYPER_REAL_MOUSE=1) + DISPLAY + xdotool + NÃO-Wayland.
 *  Em GNOME/Mutter Wayland o xdotool não alinha as coordenadas com a tela (a janela Xwayland é
 *  posicionada pelo compositor), então o cursor erra o alvo — por isso fica DESLIGADO por padrão e
 *  só liga em X11 puro, onde funciona. Sem isso, usa-se o mouse do navegador (confiável). */
export function realMouseAvailable(): boolean {
  if (process.env.TYPER_REAL_MOUSE !== "1") return false;
  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland") return false;
  return !!process.env.DISPLAY && xdotoolBin() !== null;
}

function xdo(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const bin = xdotoolBin();
    if (!bin) return resolve();
    const c = spawn(bin, args, { stdio: "ignore" });
    c.on("error", () => resolve());
    c.on("close", () => resolve());
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** posição atual do cursor real. */
function mouseLocation(): { x: number; y: number } {
  const bin = xdotoolBin();
  if (!bin) return { x: 0, y: 0 };
  const r = spawnSync(bin, ["getmouselocation", "--shell"], { encoding: "utf8", timeout: 3000 });
  const mx = r.stdout?.match(/X=(\d+)/);
  const my = r.stdout?.match(/Y=(\d+)/);
  return { x: mx ? Number(mx[1]) : 0, y: my ? Number(my[1]) : 0 };
}

/** move o cursor REAL até (x,y) de forma HUMANA: vários passos com leve jitter, não teleporta. */
export async function realMoveTo(x: number, y: number): Promise<void> {
  const start = mouseLocation();
  const steps = 14 + Math.floor(Math.random() * 10);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const jx = (Math.random() * 3 - 1.5) * (1 - t);
    const jy = (Math.random() * 3 - 1.5) * (1 - t);
    await xdo(["mousemove", String(Math.round(start.x + (x - start.x) * t + jx)), String(Math.round(start.y + (y - start.y) * t + jy))]);
    if (i % 3 === 0) await sleep(8 + Math.floor(Math.random() * 12));
  }
  await xdo(["mousemove", String(Math.round(x)), String(Math.round(y))]);
}

/** clique real (move humano + click). */
export async function realClickAt(x: number, y: number): Promise<void> {
  await realMoveTo(x, y);
  await sleep(40 + Math.floor(Math.random() * 60));
  await xdo(["click", "1"]);
}

/** APERTE E SEGURE real por ms (mouse down → micro-movimentos → up). Desafio do iFood etc. */
export async function realPressHoldAt(x: number, y: number, ms: number): Promise<void> {
  await realMoveTo(x, y);
  await xdo(["mousedown", "1"]);
  const until = Date.now() + Math.min(Math.max(ms, 500), 15_000);
  while (Date.now() < until) {
    await xdo(["mousemove_relative", "--", String(Math.round(Math.random() * 2 - 1)), String(Math.round(Math.random() * 2 - 1))]);
    await sleep(110 + Math.floor(Math.random() * 90));
  }
  await xdo(["mouseup", "1"]);
}
