// core/crypto/sign.ts
// Assinatura destacada (detached) Ed25519. Para Ed25519 o algoritmo de hash é null
// (a curva já define). Assina/verifica bytes crus ou um objeto pela sua forma
// canônica. verify nunca lança — chave/assinatura inválida devolve false.

import { sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from "node:crypto";
import { canonicalize } from "./canonical.js";

/** Assina bytes (ou string utf8) e devolve a assinatura em base64. */
export function signDetached(data: string | Buffer, privateKeyPem: string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return cryptoSign(null, buf, createPrivateKey(privateKeyPem)).toString("base64");
}

/** Verifica a assinatura base64 sobre os bytes. Nunca lança. */
export function verifyDetached(data: string | Buffer, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    return cryptoVerify(null, buf, createPublicKey(publicKeyPem), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** Assina um objeto pela sua forma canônica (reprodutível). */
export function signObject(obj: unknown, privateKeyPem: string): string {
  return signDetached(canonicalize(obj), privateKeyPem);
}

/** Verifica a assinatura de um objeto pela sua forma canônica. */
export function verifyObject(obj: unknown, signatureB64: string, publicKeyPem: string): boolean {
  return verifyDetached(canonicalize(obj), signatureB64, publicKeyPem);
}
