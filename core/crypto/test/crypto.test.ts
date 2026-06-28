import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "../src/canonical.js";
import { generateKeypair, publicKeyId, loadOrCreateIdentity } from "../src/keys.js";
import { signDetached, verifyDetached, signObject, verifyObject } from "../src/sign.js";

describe("canonicalize", () => {
  it("é estável independente da ordem das chaves", () => {
    expect(canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } })).toBe(
      canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 }),
    );
  });
  it("preserva a ordem de arrays", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("Ed25519 sign/verify", () => {
  it("round-trip de bytes (string e Buffer)", () => {
    const id = generateKeypair();
    const sig = signDetached("dados a assinar", id.privateKeyPem);
    expect(verifyDetached("dados a assinar", sig, id.publicKeyPem)).toBe(true);
    const sigBuf = signDetached(Buffer.from("abc"), id.privateKeyPem);
    expect(verifyDetached(Buffer.from("abc"), sigBuf, id.publicKeyPem)).toBe(true);
  });

  it("falha em dado adulterado", () => {
    const id = generateKeypair();
    const sig = signDetached("original", id.privateKeyPem);
    expect(verifyDetached("adulterado", sig, id.publicKeyPem)).toBe(false);
  });

  it("falha com a chave errada", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const sig = signDetached("x", a.privateKeyPem);
    expect(verifyDetached("x", sig, b.publicKeyPem)).toBe(false);
  });

  it("verify nunca lança com assinatura/chave lixo", () => {
    const id = generateKeypair();
    expect(verifyDetached("x", "não-é-base64-válido!!", id.publicKeyPem)).toBe(false);
    expect(verifyDetached("x", "", "chave inválida")).toBe(false);
  });

  it("assina e verifica um objeto pela forma canônica (independe da ordem)", () => {
    const id = generateKeypair();
    const sig = signObject({ name: "skill", tools: ["a", "b"], v: 1 }, id.privateKeyPem);
    // mesma estrutura, ordem diferente → continua válida
    expect(verifyObject({ v: 1, tools: ["a", "b"], name: "skill" }, sig, id.publicKeyPem)).toBe(true);
    // estrutura alterada → inválida
    expect(verifyObject({ name: "skill", tools: ["a", "c"], v: 1 }, sig, id.publicKeyPem)).toBe(false);
  });
});

describe("keyId e identidade", () => {
  it("publicKeyId é estável e prefixado", () => {
    const id = generateKeypair();
    expect(id.keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(publicKeyId(id.publicKeyPem)).toBe(id.keyId);
  });

  it("loadOrCreateIdentity cria (0600) e depois recarrega a mesma", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typer-crypto-"));
    const first = await loadOrCreateIdentity(dir);
    const second = await loadOrCreateIdentity(dir);
    expect(second.keyId).toBe(first.keyId);
    expect(second.privateKeyPem).toBe(first.privateKeyPem);
    // a privada assina e a pública (recarregada) verifica
    const sig = signDetached("teste", second.privateKeyPem);
    expect(verifyDetached("teste", sig, first.publicKeyPem)).toBe(true);
    // permissão 0600 na chave privada
    const mode = (await stat(join(dir, "identity.key"))).mode & 0o777;
    expect(mode).toBe(0o600);
    // a chave pública persistida bate
    expect((await readFile(join(dir, "identity.pub"), "utf8")).trim()).toBe(first.publicKeyPem.trim());
  });
});
