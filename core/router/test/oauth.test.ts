import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generatePkce,
  randomState,
  buildAuthorizeUrl,
  redirectUriFor,
  exchangeCode,
  refreshToken,
  PROVIDERS,
  type OAuthConfig,
} from "../src/oauth.js";
import { resolveAuth, saveOAuth, clearOAuth } from "../src/auth.js";

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const CFG: OAuthConfig = {
  label: "Test",
  authorizeUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token",
  clientId: "client-123",
  scope: "a b",
  mode: "loopback",
  loopbackPort: 9876,
  loopbackPath: "/cb",
};

describe("PKCE", () => {
  it("challenge é o S256(verifier) em base64url", () => {
    const p = generatePkce();
    expect(p.method).toBe("S256");
    expect(p.challenge).toBe(b64url(createHash("sha256").update(p.verifier).digest()));
    expect(p.verifier).not.toContain("="); // base64url sem padding
  });
  it("state é aleatório e não vazio", () => {
    expect(randomState()).not.toBe(randomState());
  });
});

describe("buildAuthorizeUrl", () => {
  it("carrega todos os params OAuth+PKCE", () => {
    const p = generatePkce();
    const u = new URL(buildAuthorizeUrl(CFG, p, "st8"));
    expect(u.origin + u.pathname).toBe("https://auth.example.com/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("client-123");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:9876/cb");
    expect(u.searchParams.get("scope")).toBe("a b");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("code_challenge")).toBe(p.challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("redirectUriFor usa o redirectUri fixo em modo paste", () => {
    const paste: OAuthConfig = { ...CFG, mode: "paste", redirectUri: "https://x/callback" };
    expect(redirectUriFor(paste)).toBe("https://x/callback");
  });
});

describe("exchangeCode / refreshToken (fetch stubado)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("troca code por token e calcula expiresAt", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.grant_type).toBe("authorization_code");
      expect(body.code).toBe("the-code");
      expect(body.code_verifier).toBe("ver");
      expect(body.client_id).toBe("client-123");
      return new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = await exchangeCode(CFG, "the-code", "ver");
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refresh usa grant_type=refresh_token", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      expect(JSON.parse(init.body).grant_type).toBe("refresh_token");
      return new Response(JSON.stringify({ access_token: "AT2", expires_in: 10 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = await refreshToken(CFG, "old-rt");
    expect(t.accessToken).toBe("AT2");
  });

  it("erro do endpoint vira exceção clara", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400 })));
    await expect(exchangeCode(CFG, "x", "y")).rejects.toThrow(/falha no token/);
  });
});

describe("storage (auth.json) + resolveAuth com refresh", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "typer-oauth-"));
    process.env.TYPER_AUTH_FILE = join(dir, "auth.json");
    delete process.env.TYPER_ANTHROPIC_KEY;
    delete process.env.TYPER_ANTHROPIC_OAUTH;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saveOAuth → resolveAuth devolve oauth; clearOAuth remove", async () => {
    await saveOAuth("anthropic", { accessToken: "tok-A", raw: {} });
    const a = await resolveAuth("anthropic");
    expect(a).toMatchObject({ kind: "oauth", token: "tok-A", provider: "anthropic" });
    // arquivo 0600 (POSIX)
    if (process.platform !== "win32") {
      const { stat } = await import("node:fs/promises");
      const mode = (await stat(process.env.TYPER_AUTH_FILE as string)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    expect(await clearOAuth("anthropic")).toBe(true);
    expect((await resolveAuth("anthropic")).kind).toBe("none");
  });

  it("token expirado dispara refresh e persiste o novo", async () => {
    // grava um token já expirado, com refresh_token, usando a config real do anthropic
    await saveOAuth("anthropic", {
      accessToken: "old",
      refreshToken: "RT",
      expiresAt: Date.now() - 1000,
      raw: {},
    });
    const spy = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const a = await resolveAuth("anthropic");
    expect(a).toMatchObject({ kind: "oauth", token: "fresh" });
    expect(spy).toHaveBeenCalledOnce(); // chamou o token endpoint (refresh)
    // persistiu: o arquivo agora tem o token novo e preservou o refresh_token
    const saved = JSON.parse(await readFile(process.env.TYPER_AUTH_FILE as string, "utf8"));
    expect(saved.anthropic.access_token).toBe("fresh");
    expect(saved.anthropic.refresh_token).toBe("RT");
  });
});

describe("PROVIDERS", () => {
  it("tem anthropic e openai configurados", () => {
    expect(PROVIDERS.anthropic.clientId).toBeTruthy();
    expect(PROVIDERS.openai.clientId).toBeTruthy();
    expect(PROVIDERS.anthropic.mode).toBe("paste");
    expect(PROVIDERS.openai.mode).toBe("loopback");
  });
});
