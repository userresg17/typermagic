// core/vault/index.ts — superfície pública do @typer/vault.

export { encrypt, decrypt } from "./crypto.js";
export { loadOrCreateVaultKey } from "./key.js";
export { redact, redactAll, isSensitive } from "./redact.js";
export { Vault, openVault } from "./vault.js";
