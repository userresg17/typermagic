// Teste de integração do sidecar macOS: só roda em darwin com o venv presente. Não exige TCC:
// screen_size, ping e a conversão de coordenadas (mouse_move → mouse_location) — esta última
// só é verificada se o SO aceitar o evento (Accessibility); senão fica registrada como pulada.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MacOSPlatform, findRepoRoot } from "../src/platform/macos.js";

const root = (() => {
  try {
    return findRepoRoot();
  } catch {
    return null;
  }
})();
const py = root ? join(root, ".venv", "bin", "python") : "";
const can = process.platform === "darwin" && root !== null && existsSync(py);

describe.skipIf(!can)("plataforma macOS (sidecar pyobjc)", () => {
  it("ping + screen_size devolvem a resolução lógica e a escala", async () => {
    const p = new MacOSPlatform({ root: root!, python: py, logicalWidth: 1440 });
    try {
      const pong = await p.call<{ pong: boolean }>("ping");
      expect(pong.pong).toBe(true);
      const s = await p.get_screen_size();
      expect(s.width).toBeLessThanOrEqual(1440);
      expect(s.height).toBeGreaterThan(100);
      expect(s.scale).toBeGreaterThanOrEqual(1);
    } finally {
      await p.close();
    }
  });
  it("mouse_move(x,y) lógico → mouse_location volta ao mesmo ponto (Retina ida e volta)", async () => {
    const p = new MacOSPlatform({ root: root!, python: py, logicalWidth: 1440 });
    try {
      const before = await p.mouse_location();
      const tgt = { x: 300, y: 200 };
      await p.mouse_move(tgt.x, tgt.y);
      await new Promise((r) => setTimeout(r, 120));
      const loc = await p.mouse_location();
      if (Math.abs(loc.x - before.x) < 0.5 && Math.abs(loc.y - before.y) < 0.5 && (Math.abs(before.x - tgt.x) > 2 || Math.abs(before.y - tgt.y) > 2)) {
        console.warn("[platform-macos] mouse não se moveu — Accessibility não concedido a este processo; teste de posição pulado");
        return;
      }
      expect(Math.abs(loc.x - tgt.x)).toBeLessThan(2);
      expect(Math.abs(loc.y - tgt.y)).toBeLessThan(2);
      await p.mouse_move(before.x, before.y);
    } finally {
      await p.close();
    }
  });
});
