// core/router/auth.ts
// Camada de autenticação plugável. Além de BYOK (API key, via keys.ts), aceita um
// token OAuth/bearer — pra quando houver um fluxo OFICIAL sancionado (ex.: o tipo
// de login que o próprio Claude Code usa). Ollama/local não precisa de auth.
//
// IMPORTANTE: NÃO fazemos proxy da sessão web de consumidor (ChatGPT/Claude.ai) —
// isso viola os termos e arrisca banir a conta. O token tem que vir de um meio
// legítimo; aqui só resolvemos o que o dono registrou (env ou arquivo).

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { loadKey } from "./keys.js";

export type Auth =
  | { kind: "apiKey"; key: string }
  | { kind: "oauth"; token: string }
  | { kind: "none" };

function oauthEnvVar(provider: string): string {
  return `TYPER_${provider.toUpperCase()}_OAUTH`;
}

/** Arquivo de credenciais (tokens OAuth): $TYPER_AUTH_FILE ou ~/.typer/auth.json. */
function authFilePath(): string {
  return process.env.TYPER_AUTH_FILE ?? join(homedir(), ".typer", "auth.json");
}

async function oauthFromFile(provider: string): Promise<string | null> {
  try {
    const raw = await readFile(authFilePath(), "utf8");
    const data = JSON.parse(raw) as Record<string, { oauth?: string } | string>;
    const entry = data[provider];
    if (typeof entry === "string") return entry;
    if (entry && typeof entry.oauth === "string") return entry.oauth;
    return null;
  } catch {
    return null;
  }
}

/** Resolve a auth do provider: API key (env/keychain) → token OAuth (env/arquivo) → none. */
export async function resolveAuth(provider: string): Promise<Auth> {
  const key = await loadKey(provider);
  if (key) return { kind: "apiKey", key };

  const fromEnv = process.env[oauthEnvVar(provider)];
  if (fromEnv && fromEnv.trim()) return { kind: "oauth", token: fromEnv.trim() };

  const fromFile = await oauthFromFile(provider);
  if (fromFile) return { kind: "oauth", token: fromFile };

  return { kind: "none" };
}

/** Tem credencial (key OU oauth) p/ o provider? */
export async function hasAuth(provider: string): Promise<boolean> {
  return (await resolveAuth(provider)).kind !== "none";
}

/** Headers de auth p/ o provider, conforme o tipo de credencial.
 *  style "x-api-key" (Anthropic com key) vs "bearer" (OAuth, e OpenAI sempre). */
export function authHeaders(auth: Auth, keyStyle: "x-api-key" | "bearer"): Record<string, string> {
  if (auth.kind === "apiKey") {
    return keyStyle === "x-api-key"
      ? { "x-api-key": auth.key }
      : { authorization: `Bearer ${auth.key}` };
  }
  if (auth.kind === "oauth") return { authorization: `Bearer ${auth.token}` };
  return {};
}
