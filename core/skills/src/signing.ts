// core/skills/signing.ts
// Assinatura de skill (Ed25519, via @typer/crypto). O payload assinado é o CONTEÚDO
// + manifesto na forma canônica — sem signature/publisher/hash (derivados) nem
// confinement (decisão local de confiança, não do publisher). Assim: o publisher
// assina o que afirma; o importador decide o confinamento sem quebrar a assinatura.

import { createHash } from "node:crypto";
import { signObject, verifyObject, canonicalize, type Identity } from "@typer/crypto";
import type { Skill } from "./types.js";

function payload(skill: Skill): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    methodology: skill.methodology,
    codeVersion: skill.codeVersion,
    sealed: skill.sealed,
    createdAt: skill.createdAt,
    ...(skill.manifest ? { manifest: skill.manifest } : {}),
  };
}

/** Hash de integridade do conteúdo (sha256 curto da forma canônica). */
export function skillHash(skill: Skill): string {
  return createHash("sha256").update(canonicalize(payload(skill))).digest("hex").slice(0, 16);
}

/** Assina a skill com a identidade; preenche signature, publisher (keyId) e hash. */
export function signSkill(skill: Skill, identity: Identity): Skill {
  return {
    ...skill,
    signature: signObject(payload(skill), identity.privateKeyPem),
    publisher: identity.keyId,
    hash: skillHash(skill),
  };
}

/** Verifica a assinatura da skill contra uma chave pública. Falso se ausente/adulterada. */
export function verifySkill(skill: Skill, publicKeyPem: string): boolean {
  if (!skill.signature) return false;
  return verifyObject(payload(skill), skill.signature, publicKeyPem);
}
