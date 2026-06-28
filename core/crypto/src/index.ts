// core/crypto/index.ts — superfície pública do pacote @typer/crypto.

export { canonicalize } from "./canonical.js";
export { generateKeypair, publicKeyId, loadOrCreateIdentity, type Identity } from "./keys.js";
export { signDetached, verifyDetached, signObject, verifyObject } from "./sign.js";
