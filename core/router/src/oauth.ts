// core/router/oauth.ts
// Fluxo de login OAuth 2.0 + PKCE para "entrar com a assinatura" (estilo Claude Code /
// ChatGPT Codex). Este módulo é PROTOCOLO PURO: gera o PKCE, monta a URL de autorização,
// sobe um servidor loopback p/ o callback, troca o code por token e renova. NÃO persiste
// nada (storage fica em auth.ts) nem abre navegador (isso é da superfície/CLI).
//
// AVISO (honestidade > teatro): os fluxos abaixo usam os clients OFICIAIS do Claude Code
// e do Codex. Logar aqui consome a SUA assinatura (Pro/Max/Plus) fora do app oficial —
// é zona cinzenta dos termos de cada provedor e pode arriscar a conta. A CLI mostra isso
// antes de abrir o navegador. As constantes por provider vivem em PROVIDERS (oauth-config).

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export interface Pkce {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** base64url sem padding (RFC 7636). */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Gera o par PKCE (verifier aleatório + challenge S256). */
export function generatePkce(): Pkce {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** state anti-CSRF. */
export function randomState(): string {
  return b64url(randomBytes(16));
}

/** Config OAuth de um provider (constantes do client oficial). */
export interface OAuthConfig {
  /** rótulo p/ a UI (ex.: "Claude (Pro/Max)"). */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  /** "loopback" = redirect p/ http://localhost:<port><path> (servidor local);
   *  "paste" = redirect mostra um code que o usuário cola no terminal. */
  mode: "loopback" | "paste";
  /** porta + caminho do loopback (mode "loopback"). */
  loopbackPort?: number;
  loopbackPath?: string;
  /** redirect_uri fixo (mode "paste" ou loopback explícito). */
  redirectUri?: string;
  /** params extra na URL de autorização (ex.: originator do Codex). */
  extraAuthParams?: Record<string, string>;
  /** params extra no body do /token (alguns clients exigem). */
  extraTokenParams?: Record<string, string>;
  /** inclui o `state` no body do /token — o OAuth do Claude (Anthropic) EXIGE isso; sem ele
   *  o endpoint responde "Invalid request format". (OpenAI/loopback não precisa.) */
  tokenIncludesState?: boolean;
}

export function redirectUriFor(cfg: OAuthConfig): string {
  if (cfg.redirectUri) return cfg.redirectUri;
  if (cfg.mode === "loopback") {
    return `http://localhost:${cfg.loopbackPort ?? 1455}${cfg.loopbackPath ?? "/auth/callback"}`;
  }
  throw new Error("redirectUri ausente p/ modo paste");
}

/** Monta a URL de autorização (o usuário abre no navegador). */
export function buildAuthorizeUrl(cfg: OAuthConfig, pkce: Pkce, state: string): string {
  const u = new URL(cfg.authorizeUrl);
  const q = u.searchParams;
  q.set("response_type", "code");
  q.set("client_id", cfg.clientId);
  q.set("redirect_uri", redirectUriFor(cfg));
  q.set("scope", cfg.scope);
  q.set("state", state);
  q.set("code_challenge", pkce.challenge);
  q.set("code_challenge_method", pkce.method);
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) q.set(k, v);
  return u.toString();
}

/** Lê o payload (claims) de um JWT sem verificar assinatura — só p/ extrair o account_id
 *  do id_token (a verificação real é do provider; aqui só lemos um claim público). */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Procura o account/organization id nos claims do id_token (Codex usa p/ o header
 *  ChatGPT-Account-ID). O claim é aninhado/namespaced — varremos os caminhos conhecidos. */
function accountIdFromIdToken(idToken: string): string | undefined {
  const claims = decodeJwtPayload(idToken);
  if (!claims) return undefined;
  const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  const candidates = [
    auth?.["chatgpt_account_id"],
    auth?.["organization_id"],
    claims["chatgpt_account_id"],
    claims["organization_id"],
  ];
  const hit = candidates.find((c) => typeof c === "string" && c);
  return hit as string | undefined;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms em que expira (calculado de expires_in). */
  expiresAt?: number;
  /** id da conta/assinatura, quando o provider devolve (header de inferência). */
  accountId?: string;
  /** id_token cru (JWT) — guardado p/ debug/token-exchange. */
  idToken?: string;
  raw: Record<string, unknown>;
}

function parseTokenResponse(data: Record<string, unknown>): TokenResponse {
  const accessToken = String(data.access_token ?? "");
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : undefined;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
  const idToken = typeof data.id_token === "string" ? data.id_token : undefined;
  const accountId = idToken ? accountIdFromIdToken(idToken) : undefined;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(accountId ? { accountId } : {}),
    ...(idToken ? { idToken } : {}),
    raw: data,
  };
}

async function postToken(cfg: OAuthConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...body, ...(cfg.extraTokenParams ?? {}) }),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`token endpoint devolveu não-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.access_token) {
    throw new Error(`falha no token (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return parseTokenResponse(data);
}

/** Troca o authorization code por token (com o verifier PKCE). `state` é incluído no body
 *  quando o provider exige (Anthropic) — senão o /token responde "Invalid request format". */
export function exchangeCode(
  cfg: OAuthConfig,
  code: string,
  verifier: string,
  state?: string,
): Promise<TokenResponse> {
  return postToken(cfg, {
    grant_type: "authorization_code",
    code,
    client_id: cfg.clientId,
    redirect_uri: redirectUriFor(cfg),
    code_verifier: verifier,
    ...(cfg.tokenIncludesState && state ? { state } : {}),
  });
}

/** Renova o access token a partir do refresh token. */
export function refreshToken(cfg: OAuthConfig, refresh: string): Promise<TokenResponse> {
  return postToken(cfg, {
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: cfg.clientId,
  });
}

// Configs dos providers. As constantes são dos clients OFICIAIS (Claude Code / Codex) —
// valores públicos, não segredos. CONFIRMAR/atualizar contra a implementação atual de cada
// app (podem mudar). Quem só usa BYOK/API key nunca passa por aqui.
export const PROVIDERS: Record<string, OAuthConfig> = {
  anthropic: {
    label: "Claude (Pro/Max)",
    // A Anthropic MIGROU o OAuth de claude.ai/console.anthropic.com → platform.claude.com.
    // Os domínios velhos respondem "Invalid request format". Valores extraídos do bundle real
    // do Claude Code (v2.1.196): authorize/token/redirect todos em platform.claude.com.
    authorizeUrl: "https://platform.claude.com/oauth/authorize",
    tokenUrl: "https://platform.claude.com/v1/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    // mesmos 3 scopes que o Claude Code pede (com o domínio certo, org:create_api_key passa).
    scope: "org:create_api_key user:profile user:inference",
    mode: "paste",
    redirectUri: "https://platform.claude.com/oauth/code/callback",
    // `code=true` ATIVA o fluxo manual (mostra o código na página p/ colar).
    extraAuthParams: { code: "true" },
    // o token endpoint exige o `state` no body.
    tokenIncludesState: true,
  },
  openai: {
    label: "ChatGPT (Plus/Pro)",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    // 4 escopos (igual à reimplementação que funciona). O acesso ao backend Codex NÃO é
    // dado por scope — o 400 "model not supported" era só por slug de modelo velho.
    scope: "openid profile email offline_access",
    mode: "loopback",
    loopbackPort: 1455,
    loopbackPath: "/auth/callback",
    extraAuthParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
    },
  },
};

export interface CallbackResult {
  code: string;
  state: string;
}

/** Sobe um servidor loopback efêmero e resolve quando o provider redireciona com o code.
 *  Fecha sozinho após o primeiro hit (ou no timeout). */
export function waitForLoopbackCallback(
  cfg: OAuthConfig,
  expectedState: string,
  timeoutMs = 5 * 60_000,
): Promise<CallbackResult> {
  const port = cfg.loopbackPort ?? 1455;
  const path = cfg.loopbackPath ?? "/auth/callback";
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== path) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset=utf-8><title>Typermagic</title>` +
          `<body style="font-family:system-ui;text-align:center;padding:3rem">` +
          (code && state === expectedState
            ? `<h2>✓ Login concluído</h2><p>Pode fechar esta aba e voltar ao terminal.</p>`
            : `<h2>✗ Falha no login</h2><p>${err ?? "code/state inválido"}</p>`) +
          `</body>`,
      );
      clearTimeout(timer);
      server.close();
      if (err) return reject(new Error(`provider retornou erro: ${err}`));
      if (!code) return reject(new Error("callback sem code"));
      if (state !== expectedState) return reject(new Error("state não confere (possível CSRF)"));
      resolve({ code, state });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("tempo esgotado esperando o callback do navegador"));
    }, timeoutMs);
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.listen(port, "127.0.0.1");
  });
}
