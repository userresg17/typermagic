// core/vault/key.ts
// Resolve a CHAVE-MESTRA do vault (32 bytes), em ordem de precedência:
//   1. env TYPER_VAULT_KEY (base64) — CI/Docker/headless explícito.
//   2. keychain do SO via keytar (se instalado) — destrava 24/7 sem intervenção.
//   3. arquivo ~/.typer/vault.key (0600, gerado) — fallback; promove ao keychain.
// keytar é OPCIONAL: carregado dinamicamente; ausência (headless/sem libsecret) cai no
// arquivo. A chave protege o vault em repouso contra roubo de disco offline.

import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "typer-vault";
const ACCOUNT = "master-key";

/** keytar carregado em runtime — specifier por variável evita o erro de tipo quando o
 *  pacote não está instalado (é dependência opcional). */
async function keytarModule(): Promise<{
  getPassword(s: string, a: string): Promise<string | null>;
  setPassword(s: string, a: string, v: string): Promise<void>;
} | null> {
  try {
    const spec = "keytar";
    const mod = (await import(spec)) as { default?: unknown } & Record<string, unknown>;
    return (mod.default ?? mod) as never;
  } catch {
    return null; // ausente/headless: segue p/ o arquivo
  }
}

function defaultDir(): string {
  return process.env.TYPER_VAULT_DIR ?? join(homedir(), ".typer");
}

/** Resolve (ou cria) a chave-mestra de 32 bytes. Idempotente. */
export async function loadOrCreateVaultKey(dir: string = defaultDir()): Promise<Buffer> {
  // 1. env explícito
  const env = process.env.TYPER_VAULT_KEY;
  if (env) {
    const k = Buffer.from(env, "base64");
    if (k.length === 32) return k;
    throw new Error("TYPER_VAULT_KEY deve ser 32 bytes em base64");
  }

  // 2. keychain do SO (se disponível)
  const kt = await keytarModule();
  if (kt) {
    const v = await kt.getPassword(SERVICE, ACCOUNT).catch(() => null);
    if (v) {
      const k = Buffer.from(v, "base64");
      if (k.length === 32) return k;
    }
  }

  // 3. arquivo 0600 (fallback); se gerar, promove ao keychain
  const path = join(dir, "vault.key");
  try {
    const f = (await readFile(path, "utf8")).trim();
    const k = Buffer.from(f, "base64");
    if (k.length === 32) return k;
  } catch {
    /* gerar abaixo */
  }
  const key = randomBytes(32);
  await mkdir(dir, { recursive: true });
  await writeFile(path, key.toString("base64"), { mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
  if (kt) await kt.setPassword(SERVICE, ACCOUNT, key.toString("base64")).catch(() => {});
  return key;
}
