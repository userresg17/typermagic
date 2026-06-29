import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "../src/crypto.js";
import { redact, redactAll, isSensitive } from "../src/redact.js";
import { Vault } from "../src/vault.js";
import { loadOrCreateVaultKey } from "../src/key.js";

const KEY = randomBytes(32);

describe("crypto AES-256-GCM", () => {
  it("cifra e decifra (roundtrip)", () => {
    const blob = encrypt(KEY, "cartão 4111 1111 1111 1111");
    expect(blob).not.toContain("4111");
    expect(decrypt(KEY, blob)).toBe("cartão 4111 1111 1111 1111");
  });
  it("chave errada → LANÇA (não devolve lixo)", () => {
    const blob = encrypt(KEY, "segredo");
    expect(() => decrypt(randomBytes(32), blob)).toThrow();
  });
  it("blob adulterado → LANÇA (integridade GCM)", () => {
    const blob = encrypt(KEY, "segredo");
    const tampered = Buffer.from(blob, "base64");
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(KEY, tampered.toString("base64"))).toThrow();
  });
  it("rejeita chave de tamanho errado", () => {
    expect(() => encrypt(randomBytes(16), "x")).toThrow(/32 bytes/);
  });
});

describe("redact", () => {
  it("cartão → só os 4 últimos", () => {
    expect(redact("card_number", "4111 1111 1111 1234")).toBe("•••• 1234");
    expect(redact("cartao", "4111111111119999")).toBe("•••• 9999");
  });
  it("cvv/senha/token → mascarado total", () => {
    expect(redact("card_cvv", "123")).toBe("•••");
    expect(redact("gmail_password", "hunter2")).toBe("•••");
    expect(redact("api_token", "abc")).toBe("•••");
  });
  it("não-sensível → exibe", () => {
    expect(redact("name", "Junior")).toBe("Junior");
    expect(redact("address", "Rua X, 100")).toBe("Rua X, 100");
  });
  it("isSensitive classifica certo", () => {
    expect(isSensitive("card_number")).toBe(true);
    expect(isSensitive("card_cvv")).toBe(true);
    expect(isSensitive("name")).toBe(false);
  });
  it("redactAll redige o mapa inteiro", () => {
    const out = redactAll({ card_number: "4111111111111234", card_cvv: "999", name: "Ana" });
    expect(out).toEqual({ card_number: "•••• 1234", card_cvv: "•••", name: "Ana" });
  });
});

describe("Vault (cifrado em repouso, 0600)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "typer-vault-"));
  });

  it("set/get e persiste cifrado; reabrir recupera", async () => {
    const v = await Vault.open(dir, KEY);
    await v.set("card_number", "4111111111111234");
    await v.set("name", "Junior");
    // o arquivo no disco NÃO contém o segredo em texto puro
    const onDisk = await readFile(join(dir, "vault.enc"), "utf8");
    expect(onDisk).not.toContain("4111");
    expect(onDisk).not.toContain("Junior");
    // reabrir com a mesma chave recupera
    const v2 = await Vault.open(dir, KEY);
    expect(v2.get("card_number")).toBe("4111111111111234");
    expect(v2.get("name")).toBe("Junior");
  });

  it("summary redige (cartão final-4, cvv mascarado), fields só nomes", async () => {
    const v = await Vault.open(dir, KEY);
    await v.setMany({ card_number: "4111111111119876", card_cvv: "321", religion: "nenhuma" });
    expect(v.summary()).toEqual({ card_number: "•••• 9876", card_cvv: "•••", religion: "nenhuma" });
    expect(v.fields().sort()).toEqual(["card_cvv", "card_number", "religion"]);
  });

  it("reabrir com chave ERRADA não vaza (vault vazio, não lixo)", async () => {
    const v = await Vault.open(dir, KEY);
    await v.set("card_number", "4111111111110000");
    const wrong = await Vault.open(dir, randomBytes(32));
    expect(wrong.fields()).toEqual([]); // decrypt falhou → vault vazio, sem crash
  });

  it("arquivo vault.enc é 0600 (POSIX)", async () => {
    const v = await Vault.open(dir, KEY);
    await v.set("x", "y");
    if (process.platform !== "win32") {
      const mode = (await stat(join(dir, "vault.enc"))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("delete remove o campo", async () => {
    const v = await Vault.open(dir, KEY);
    await v.set("tmp", "z");
    await v.delete("tmp");
    expect(v.has("tmp")).toBe(false);
  });
});

describe("loadOrCreateVaultKey", () => {
  it("gera chave de 32 bytes 0600 e é idempotente (mesmo dir → mesma chave)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typer-vkey-"));
    delete process.env.TYPER_VAULT_KEY;
    const k1 = await loadOrCreateVaultKey(dir);
    expect(k1.length).toBe(32);
    const k2 = await loadOrCreateVaultKey(dir);
    expect(k2.equals(k1)).toBe(true);
    if (process.platform !== "win32") {
      const mode = (await stat(join(dir, "vault.key"))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
  it("env TYPER_VAULT_KEY tem precedência", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typer-vkey-"));
    const fixed = randomBytes(32);
    process.env.TYPER_VAULT_KEY = fixed.toString("base64");
    try {
      const k = await loadOrCreateVaultKey(dir);
      expect(k.equals(fixed)).toBe(true);
    } finally {
      delete process.env.TYPER_VAULT_KEY;
    }
  });
});
