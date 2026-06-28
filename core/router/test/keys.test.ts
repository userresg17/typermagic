import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadKey, hasKey } from "../src/keys.js";

describe("keys — resolução BYOK", () => {
  const VAR = "TYPER_TESTPROV_KEY";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[VAR];
    delete process.env[VAR];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[VAR];
    else process.env[VAR] = original;
  });

  it("lê a chave da variável de ambiente", async () => {
    process.env[VAR] = "sk-teste-123";
    expect(await loadKey("testprov")).toBe("sk-teste-123");
    expect(await hasKey("testprov")).toBe(true);
  });

  it("apara espaços em volta da chave", async () => {
    process.env[VAR] = "  sk-teste-123  ";
    expect(await loadKey("testprov")).toBe("sk-teste-123");
  });

  it("retorna null sem env e sem keychain", async () => {
    expect(await loadKey("testprov")).toBeNull();
    expect(await hasKey("testprov")).toBe(false);
  });
});
