// core/router/auth.ts
// Camada de autenticação plugável. Três fontes, nesta ordem de preferência:
//   1. API key (BYOK, via keys.ts — env ou keychain)         → x-api-key/Bearer
//   2. Login OAuth "com a assinatura" (auth.json, c/ refresh)  → Bearer + extras
//   3. token OAuth cru colado (env TYPER_<P>_OAUTH)            → Bearer
//
// O login OAuth (oauth.ts) usa os clients OFICIAIS do Claude Code / Codex — consome a
// assinatura do dono fora do app oficial (zona cinzenta dos termos). Já o que NÃO fazemos:
// proxy de sessão web de consumidor por cookie. O token vem de um fluxo OAuth com consentimento.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { loadKey } from "./keys.js";
import { PROVIDERS, refreshToken, type TokenResponse } from "./oauth.js";

export type Auth =
  | { kind: "apiKey"; key: string }
  | { kind: "oauth"; token: string; provider: string; accountId?: string }
  | { kind: "none" };

/** Registro persistido de um login OAuth (auth.json). */
export interface OAuthRecord {
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at?: number;
  account_id?: string;
  id_token?: string;
}

function oauthEnvVar(provider: string): string {
  return `TYPER_${provider.toUpperCase()}_OAUTH`;
}

/** Arquivo de credenciais OAuth: $TYPER_AUTH_FILE ou ~/.typer/auth.json (0600). */
function authFilePath(): string {
  return process.env.TYPER_AUTH_FILE ?? join(homedir(), ".typer", "auth.json");
}

type AuthFile = Record<string, OAuthRecord | { oauth?: string } | string>;

async function readAuthFile(): Promise<AuthFile> {
  try {
    return JSON.parse(await readFile(authFilePath(), "utf8")) as AuthFile;
  } catch {
    return {};
  }
}

async function writeAuthFile(data: AuthFile): Promise<void> {
  const path = authFilePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
  await chmod(path, 0o600).catch(() => {}); // tokens são sensíveis (POSIX; Windows ignora)
}

/** Normaliza uma entrada do auth.json para OAuthRecord (aceita formatos antigos). */
function asRecord(entry: AuthFile[string] | undefined): OAuthRecord | null {
  if (!entry) return null;
  if (typeof entry === "string") return { access_token: entry };
  if ("access_token" in entry && typeof entry.access_token === "string") return entry as OAuthRecord;
  if ("oauth" in entry && typeof entry.oauth === "string") return { access_token: entry.oauth };
  return null;
}

/** Persiste o resultado de um login/refresh OAuth. */
export async function saveOAuth(provider: string, tok: TokenResponse): Promise<void> {
  const data = await readAuthFile();
  data[provider] = {
    access_token: tok.accessToken,
    ...(tok.refreshToken ? { refresh_token: tok.refreshToken } : {}),
    ...(tok.expiresAt ? { expires_at: tok.expiresAt } : {}),
    ...(tok.accountId ? { account_id: tok.accountId } : {}),
    ...(tok.idToken ? { id_token: tok.idToken } : {}),
  };
  await writeAuthFile(data);
}

/** Remove o login OAuth de um provider (logout). */
export async function clearOAuth(provider: string): Promise<boolean> {
  const data = await readAuthFile();
  if (!(provider in data)) return false;
  delete data[provider];
  await writeAuthFile(data);
  return true;
}

const REFRESH_SKEW_MS = 60_000; // renova 1 min antes de expirar

/** Resolve um OAuthRecord, renovando via refresh_token se estiver perto de expirar. */
async function resolveOAuthRecord(provider: string): Promise<OAuthRecord | null> {
  const rec = asRecord((await readAuthFile())[provider]);
  if (!rec) return null;
  const expired = rec.expires_at !== undefined && rec.expires_at - REFRESH_SKEW_MS <= Date.now();
  const cfg = PROVIDERS[provider];
  if (expired && rec.refresh_token && cfg) {
    try {
      const tok = await refreshToken(cfg, rec.refresh_token);
      // alguns providers não reemitem o refresh_token — preserva o antigo
      if (!tok.refreshToken && rec.refresh_token) tok.refreshToken = rec.refresh_token;
      if (!tok.accountId && rec.account_id) tok.accountId = rec.account_id;
      await saveOAuth(provider, tok);
      return asRecord((await readAuthFile())[provider]);
    } catch {
      return rec; // refresh falhou: tenta o token atual (pode ainda valer alguns segundos)
    }
  }
  return rec;
}

/** Resolve a auth do provider: API key → login OAuth (c/ refresh) → token cru no env → none. */
export async function resolveAuth(provider: string): Promise<Auth> {
  const key = await loadKey(provider);
  if (key) return { kind: "apiKey", key };

  const rec = await resolveOAuthRecord(provider);
  if (rec) {
    return {
      kind: "oauth",
      token: rec.access_token,
      provider,
      ...(rec.account_id ? { accountId: rec.account_id } : {}),
    };
  }

  const fromEnv = process.env[oauthEnvVar(provider)];
  if (fromEnv && fromEnv.trim()) return { kind: "oauth", token: fromEnv.trim(), provider };

  return { kind: "none" };
}

/** Tem credencial (key OU oauth) p/ o provider? */
export async function hasAuth(provider: string): Promise<boolean> {
  return (await resolveAuth(provider)).kind !== "none";
}

/** Headers de auth p/ o provider, conforme o tipo de credencial.
 *  style "x-api-key" (Anthropic com key) vs "bearer" (OAuth, e OpenAI sempre).
 *  Extras específicos do provider (anthropic-beta, chatgpt-account-id) entram no
 *  provider, a partir do Auth resolvido. */
export function authHeaders(auth: Auth, keyStyle: "x-api-key" | "bearer"): Record<string, string> {
  if (auth.kind === "apiKey") {
    return keyStyle === "x-api-key" ? { "x-api-key": auth.key } : { authorization: `Bearer ${auth.key}` };
  }
  if (auth.kind === "oauth") return { authorization: `Bearer ${auth.token}` };
  return {};
}
