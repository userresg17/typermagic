// core/vault/vault.ts
// O cofre: um mapa campo→valor cifrado em repouso (~/.typer/vault.enc, AES-256-GCM, 0600).
// get() devolve o valor PLENO — usado SÓ pelos preenchedores determinísticos (vault_fill),
// nunca volta pro modelo. summary() devolve a visão REDIGIDA (cartão final-4) p/ exibir no
// HITL/log. O modelo enxerga só nomes de campo (fields()), nunca valores sensíveis.

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { encrypt, decrypt } from "./crypto.js";
import { loadOrCreateVaultKey } from "./key.js";
import { redactAll, isSensitive } from "./redact.js";

function defaultDir(): string {
  return process.env.TYPER_VAULT_DIR ?? join(homedir(), ".typer");
}

export class Vault {
  private constructor(
    private readonly key: Buffer,
    private readonly path: string,
    private data: Record<string, string>,
  ) {}

  /** Abre o vault de `dir` com a `key` dada (injeta a chave — testável). */
  static async open(dir: string, key: Buffer): Promise<Vault> {
    const path = join(dir, "vault.enc");
    let data: Record<string, string> = {};
    try {
      const blob = (await readFile(path, "utf8")).trim();
      if (blob) data = JSON.parse(decrypt(key, blob)) as Record<string, string>;
    } catch {
      /* arquivo ausente/novo → vault vazio */
    }
    return new Vault(key, path, data);
  }

  /** Valor pleno de um campo (SÓ p/ preenchedor determinístico; nunca p/ o modelo). */
  get(field: string): string | undefined {
    return this.data[field];
  }

  /** Grava/atualiza um campo e persiste cifrado. */
  async set(field: string, value: string): Promise<void> {
    this.data[field] = value;
    await this.save();
  }

  /** Grava vários campos de uma vez (onboarding) e persiste uma vez só. */
  async setMany(entries: Record<string, string>): Promise<void> {
    Object.assign(this.data, entries);
    await this.save();
  }

  async delete(field: string): Promise<void> {
    delete this.data[field];
    await this.save();
  }

  /** Nomes dos campos (sem valores) — seguro p/ o modelo saber o que existe. */
  fields(): string[] {
    return Object.keys(this.data);
  }

  has(field: string): boolean {
    return field in this.data;
  }

  /** Visão REDIGIDA (cartão final-4, CVV/senha mascarados) — segura p/ HITL/log. */
  summary(): Record<string, string> {
    return redactAll(this.data);
  }

  /** Um campo é sensível (não pode ser exibido pleno)? */
  isSensitive(field: string): boolean {
    return isSensitive(field);
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, encrypt(this.key, JSON.stringify(this.data)), { mode: 0o600 });
    if (process.platform !== "win32") await chmod(this.path, 0o600);
  }
}

/** Conveniência: resolve a chave-mestra e abre o vault de `dir` (default ~/.typer). */
export async function openVault(dir: string = defaultDir()): Promise<Vault> {
  const key = await loadOrCreateVaultKey(dir);
  return Vault.open(dir, key);
}
