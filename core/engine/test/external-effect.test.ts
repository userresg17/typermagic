import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../src/engine.js";

const host = { approve: () => true };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-f1-"));
});

describe("callTool — selo de efeito externo (F1)", () => {
  it("NEGA ação irreversível (git_commit) numa superfície autônoma (scheduler/never)", async () => {
    const engine = createEngine({ root, surface: "scheduler", provider: "fake", approval: "never" }, host);
    // git_commit: permission write + exec subprocess ∈ grant do scheduler; o broker passa,
    // mas o policy gate nega por ser IRREVERSÍVEL numa superfície autônoma. Nunca roda git.
    await expect(engine.callTool("git_commit", { message: "x" })).rejects.toThrow(/irrevers|aut[oô]noma/i);
  });

  it("NEGA irreversível num gateway autônomo mesmo com grant ampliado", async () => {
    const engine = createEngine(
      {
        root,
        surface: "gateway:tg",
        provider: "fake",
        approval: "never",
        capabilities: { permissions: ["read", "write", "exec"], exec: ["subprocess"] },
      },
      host,
    );
    await expect(engine.callTool("git_commit", { message: "x" })).rejects.toThrow(/irrevers|aut[oô]noma/i);
  });

  it("irreversível interativa (cli) PEDE aprovação — negada se o host nega (nunca roda git)", async () => {
    const denyHost = { approve: () => false };
    const engine = createEngine({ root, surface: "cli", provider: "fake", approval: "first-only" }, denyHost);
    await expect(engine.callTool("git_commit", { message: "x" })).rejects.toThrow(/aprova[çc][aã]o negada|irrevers/i);
  });

  it("o broker já barra escrita num gateway READONLY (antes mesmo do policy gate)", async () => {
    const engine = createEngine({ root, surface: "gateway:tg", provider: "fake", approval: "never" }, host);
    // gateway default = READONLY: git_commit (write) é negado pelo broker de capacidade.
    await expect(engine.callTool("git_commit", { message: "x" })).rejects.toThrow(/permiss[aã]o|capability/i);
  });

  it("sandbox_exec roda código ISOLADO pela Engine (cli; broker permite microvm)", async () => {
    const engine = createEngine({ root, surface: "cli", provider: "fake" }, host);
    const out = await engine.callTool("sandbox_exec", {
      code: "process.stdout.write('isolado ' + (2 * 3))",
      lang: "js",
    });
    expect(String(out)).toContain("isolado 6");
  });

  it("gateway READONLY NÃO pode rodar código no sandbox (broker nega microvm)", async () => {
    const engine = createEngine({ root, surface: "gateway:tg", provider: "fake", approval: "never" }, host);
    await expect(engine.callTool("sandbox_exec", { code: "x", lang: "js" })).rejects.toThrow(
      /execu[çc][aã]o|capability|permiss/i,
    );
  });
});
