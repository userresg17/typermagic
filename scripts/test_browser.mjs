#!/usr/bin/env node
// scripts/test_browser.mjs — verificação da Fase 3: abre o navegador real (perfil dedicado, CDP,
// sem stealth), navega, lê o título, lê o estado (DOM numerado + acessibilidade) e salva um
// screenshot. Uso: scripts/env.sh node scripts/test_browser.mjs [url]
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const { openCdpBrowser, defaultCdpProfile } = await import(new URL("../core/agent/dist/index.js", import.meta.url).href);

const url = process.argv[2] ?? "https://example.com/";
const logDir = process.env.TYPER_LOG_DIR ?? join(homedir(), "Library", "Logs", "typermagic");
mkdirSync(logDir, { recursive: true });
console.log(`perfil dedicado: ${defaultCdpProfile()} · porta ${process.env.TYPER_CDP_PORT ?? 9222}`);
const t0 = Date.now();
const b = await openCdpBrowser();
console.log(`✓ conectado via CDP em ${Date.now() - t0}ms`);
await b.goto(url);
const st = await b.state();
console.log(`✓ título: ${st.title}`);
console.log(`✓ url: ${st.url}`);
console.log(`✓ elementos interativos: ${st.elements.length} · texto ${st.text.length} chars · acessibilidade ${st.text.startsWith("ACESSIBILIDADE") ? "sim" : "não"}`);
const png = await b.screenshotMarked();
const out = join(logDir, "test-browser.png");
writeFileSync(out, Buffer.from(png, "base64"));
console.log(`✓ screenshot ${Math.round(png.length / 1024)} KB b64 → ${out}`);
if (!st.title || !png) {
  console.error("✗ falhou: sem título ou sem screenshot");
  process.exit(1);
}
await b.close();
console.log("✓ Fase 3 OK (navegador fica aberto p/ a próxima tarefa)");
process.exit(0);
