// core/crypto/keys.ts
// Identidade Ed25519 (par de chaves) via node:crypto — zero dependência. A chave
// privada nunca vai ao repo; mora em disco com permissão 0600 (como o BYOK). O
// keyId é um hash curto da chave pública (spki DER), estável e legível.

import { generateKeyPairSync, createPublicKey, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface Identity {
  /** chave privada PEM (pkcs8) — NUNCA versionar/expor */
  privateKeyPem: string;
  /** chave pública PEM (spki) — pode ser publicada */
  publicKeyPem: string;
  /** id derivado da chave pública, ex. "ed25519:ab12..." */
  keyId: string;
}

/** Gera um par Ed25519 novo. */
export function generateKeypair(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { privateKeyPem, publicKeyPem, keyId: publicKeyId(publicKeyPem) };
}

/** Id estável de uma chave pública: ed25519:<sha256(spki der) curto>. */
export function publicKeyId(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return "ed25519:" + createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Carrega a identidade de `dir` ou cria uma nova (privada 0600) e persiste. */
export async function loadOrCreateIdentity(dir: string): Promise<Identity> {
  const privPath = join(dir, "identity.key");
  const pubPath = join(dir, "identity.pub");
  try {
    const privateKeyPem = await readFile(privPath, "utf8");
    const publicKeyPem = await readFile(pubPath, "utf8");
    return { privateKeyPem, publicKeyPem, keyId: publicKeyId(publicKeyPem) };
  } catch {
    const id = generateKeypair();
    await mkdir(dir, { recursive: true });
    await writeFile(privPath, id.privateKeyPem, { mode: 0o600 });
    await writeFile(pubPath, id.publicKeyPem, { mode: 0o644 });
    return id;
  }
}
