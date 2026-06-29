// core/vault/crypto.ts
// AES-256-GCM autenticado (node:crypto, zero dep). Formato do blob: base64(iv|tag|ct),
// iv=12 bytes, tag=16 bytes. GCM dá confidencialidade E integridade: decifrar com a
// chave errada (ou blob adulterado) LANÇA — não devolve lixo silencioso.

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

/** Cifra `plaintext` com a chave de 32 bytes; devolve base64(iv|tag|ciphertext). */
export function encrypt(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error("chave AES-256 deve ter 32 bytes");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decifra um blob produzido por `encrypt`. Lança se a chave/integridade falham. */
export function decrypt(key: Buffer, blob: string): string {
  if (key.length !== 32) throw new Error("chave AES-256 deve ter 32 bytes");
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
