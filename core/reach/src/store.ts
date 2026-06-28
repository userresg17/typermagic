// core/reach/store.ts
// Armazena credenciais/cookies/preferências do reach em ~/.typer/reach/config.json
// (0600 — os tokens são sensíveis). Mesmo padrão do core/router/auth.ts. Resolve
// também por variável de ambiente (UPPER), como o agent-reach.

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import type { ReachConfig } from "./types.js";

function reachDir(): string {
  return process.env.TYPER_REACH_DIR ?? join(homedir(), ".typer", "reach");
}

function configPath(): string {
  return join(reachDir(), "config.json");
}

export async function loadConfig(): Promise<ReachConfig> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as ReachConfig;
  } catch {
    return {};
  }
}

export async function saveConfig(cfg: ReachConfig): Promise<void> {
  const path = configPath();
  await mkdir(reachDir(), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
  await chmod(path, 0o600).catch(() => {}); // POSIX; Windows ignora
}

/** Grava uma credencial e persiste. */
export async function setCred(key: string, value: string): Promise<void> {
  const cfg = await loadConfig();
  cfg[key] = value;
  await saveConfig(cfg);
}

/** Resolve uma credencial: config → variável de ambiente (UPPER). */
export function resolveCred(cfg: ReachConfig, key: string): string | undefined {
  const v = cfg[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  const env = process.env[key.toUpperCase()];
  return env && env.trim() ? env.trim() : undefined;
}
