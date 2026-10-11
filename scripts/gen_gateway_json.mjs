#!/usr/bin/env node
// scripts/gen_gateway_json.mjs — escreve .typer/gateway.json a partir do .env (allowlist, grants,
// navegador CDP, desktop, cofre). Idempotente: preserva chaves que você editou à mão.
// Uso: scripts/env.sh node scripts/gen_gateway_json.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const allow = (process.env.TYPER_TELEGRAM_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!allow.length) {
  console.error("✗ TYPER_TELEGRAM_ALLOW vazio no .env — defina seu id numérico do Telegram.");
  process.exit(1);
}
const path = join(root, ".typer", "gateway.json");
let cur = {};
if (existsSync(path)) {
  try {
    cur = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    cur = {};
  }
}
const grants = Object.fromEntries(
  allow.map((id) => [id, cur.grants?.[id] ?? { permissions: ["read", "meta", "network", "desktop"], exec: ["in_process", "subprocess"] }]),
);
const out = {
  ...cur,
  allow,
  rateCapacity: cur.rateCapacity ?? 5,
  rateRefillMs: cur.rateRefillMs ?? 4000,
  features: cur.features ?? { tools: true, memory: true },
  // macOS: navegador real via CDP (perfil dedicado, sem stealth); headless irrelevante aqui
  browser: cur.browser ?? { headless: false },
  desktop: cur.desktop ?? true,
  vault: cur.vault ?? true,
  checkpointEvery: cur.checkpointEvery ?? 5,
  ...(process.env.TYPER_PROVIDER ? { provider: process.env.TYPER_PROVIDER } : {}),
  ...(process.env.TYPER_MODEL ? { model: process.env.TYPER_MODEL } : {}),
  grants,
};
mkdirSync(join(root, ".typer"), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
console.log(`✓ ${path} escrito (allow=${allow.join(",")}, desktop=${out.desktop}, vault=${out.vault})`);
