#!/usr/bin/env node
// scripts/test_desktop_agent.mjs — Fase 2 ponta a ponta pelo TS: runDesktopAgent com a Platform
// macOS REAL e um "LLM" roteirizado (sem chave): abre o TextEdit, escreve via acessibilidade,
// confere na árvore, manda checkpoint e fecha. Exige TCC concedido ao python do venv.
// Uso: TYPER_ALLOWED_APPS=TextEdit scripts/env.sh node scripts/test_desktop_agent.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const { pickPlatform, runDesktopAgent } = await import(new URL("../core/agent/dist/index.js", import.meta.url).href);

process.env.TYPER_ALLOWED_APPS ||= "TextEdit";
const PHRASE = "Olá do sub-agente de desktop";
const logDir = join(homedir(), "Library", "Logs", "typermagic");
mkdirSync(logDir, { recursive: true });
const p = pickPlatform();
let shots = 0;
const plans = [
  { actions: [{ action: "open_app", name: "TextEdit" }] },
  { actions: [{ action: "key", combo: "escape" }, { action: "key", combo: "cmd+n" }] },
  null, // decidido em runtime: ax_act no TextArea
  null, // conferência + done
];
let step = 0;
const llm = async (_system, messages) => {
  const state = messages.at(-1).content;
  const img = messages.at(-1).images?.[0];
  if (img) {
    shots++;
    writeFileSync(join(logDir, `test-desktop-step${step + 1}.png`), Buffer.from(img, "base64"));
  }
  let plan = plans[step];
  if (step === 2) {
    const m = state.match(/\[(\d+)\] TextArea/);
    if (!m) return JSON.stringify({ actions: [{ action: "done", text: "FALHA: sem TextArea na árvore", success: false }] });
    plan = { actions: [{ action: "ax_act", id: Number(m[1]), value: PHRASE }] };
  } else if (step === 3) {
    const ok = state.includes(PHRASE);
    plan = { actions: [{ action: "done", text: ok ? `OK: frase encontrada na árvore AX` : "FALHA: frase não apareceu", success: ok }] };
  }
  step++;
  return JSON.stringify(plan ?? { actions: [{ action: "done", text: "fim" }] });
};
const t0 = Date.now();
const out = await runDesktopAgent("escreva a frase no TextEdit", {
  platform: p,
  llm,
  maxSteps: 6,
  checkpointEvery: 1,
  checkpoint: async (_png, cap) => console.log(`  📸 checkpoint: ${cap}`),
  onStep: (s) => console.log(`  passo ${s.step} @ ${s.app} → ${s.describe}`),
});
console.log(`resultado: ${out} (${Date.now() - t0} ms, ${shots} screenshots)`);
// fecha sem salvar: quit via AppleScript + botão "Apagar" por AX (nunca atalho cego)
await p.quit_app("TextEdit").catch(() => {});
await new Promise((r) => setTimeout(r, 800));
if ((await p.frontmost_app()).name === "TextEdit") {
  const t = await p.ax_tree();
  const b = t.nodes.find((n) => n.role === "Button" && /^(apagar|delete|não salvar|don't save)$/i.test(n.label));
  if (b) await p.ax_act(b.id, "Press");
  await new Promise((r) => setTimeout(r, 500));
  await p.quit_app("TextEdit").catch(() => {});
}
await p.close();
process.exit(out.startsWith("OK") ? 0 : 1);
