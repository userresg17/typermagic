import { describe, it, expect, beforeEach } from "vitest";
import { resolveAuth, authHeaders } from "../src/auth.js";

// arquivo de auth inexistente → resolução determinística (sem ~/.typer/auth.json)
beforeEach(() => {
  process.env.TYPER_AUTH_FILE = "/tmp/typer-nonexistent-auth.json";
  delete process.env.TYPER_ZZAUTH_KEY;
  delete process.env.TYPER_ZZAUTH_OAUTH;
});

describe("resolveAuth", () => {
  it("none quando não há credencial", async () => {
    expect((await resolveAuth("zzauth")).kind).toBe("none");
  });

  it("apiKey via env (BYOK) tem prioridade", async () => {
    process.env.TYPER_ZZAUTH_KEY = "k1";
    process.env.TYPER_ZZAUTH_OAUTH = "tok";
    expect(await resolveAuth("zzauth")).toEqual({ kind: "apiKey", key: "k1" });
  });

  it("oauth via env quando não há key", async () => {
    process.env.TYPER_ZZAUTH_OAUTH = "tok";
    expect(await resolveAuth("zzauth")).toEqual({ kind: "oauth", token: "tok", provider: "zzauth" });
  });
});

describe("authHeaders", () => {
  it("apiKey no estilo x-api-key (Anthropic)", () => {
    expect(authHeaders({ kind: "apiKey", key: "k" }, "x-api-key")).toEqual({ "x-api-key": "k" });
  });
  it("apiKey no estilo bearer (OpenAI)", () => {
    expect(authHeaders({ kind: "apiKey", key: "k" }, "bearer")).toEqual({ authorization: "Bearer k" });
  });
  it("oauth sempre vira Bearer", () => {
    expect(authHeaders({ kind: "oauth", token: "t", provider: "x" }, "x-api-key")).toEqual({
      authorization: "Bearer t",
    });
  });
  it("none não manda header", () => {
    expect(authHeaders({ kind: "none" }, "bearer")).toEqual({});
  });
});
