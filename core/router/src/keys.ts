// core/router/keys.ts
// BYOK — a chave nunca em texto plano no repo. Ordem de resolução pensada para
// rodar primeiro em container Docker (sem keychain) e depois nativo no Linux:
//
//   1. variável de ambiente  TYPER_<PROVIDER>_KEY   (Docker, CI, native)
//   2. keychain do sistema    via keytar             (native, opcional)
//
// O keytar é carregado de forma preguiçosa e tolerante: se não estiver
// instalado ou se não houver Secret Service (container headless), a resolução
// cai no env sem quebrar. Trocar a fonte da chave é trocar esta implementação,
// não o chamador (princípio do ADR-004).

const SERVICE = "typer-code";

function envVarName(provider: string): string {
  return `TYPER_${provider.toUpperCase()}_KEY`;
}

// keytar é dependência opcional/nativa, não fixa (Docker-first). O specifier
// fica numa variável tipada como string para o TypeScript não tentar resolver
// o módulo em tempo de build — ele só existe quando instalado no uso nativo.
const KEYTAR: string = "keytar";

/** Tenta o keychain do sistema; retorna null se indisponível. */
async function loadFromKeychain(provider: string): Promise<string | null> {
  try {
    const keytar = await import(KEYTAR).catch(() => null);
    if (!keytar) return null;
    const mod = (keytar as { default?: unknown }).default ?? keytar;
    const getPassword = (mod as { getPassword?: unknown }).getPassword;
    if (typeof getPassword !== "function") return null;
    return (await getPassword(SERVICE, provider)) ?? null;
  } catch {
    return null;
  }
}

/** Resolve a chave do provider. Env primeiro, keychain depois. */
export async function loadKey(provider: string): Promise<string | null> {
  const fromEnv = process.env[envVarName(provider)];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return loadFromKeychain(provider);
}

/** Grava no keychain quando disponível (uso nativo). */
export async function saveKey(provider: string, key: string): Promise<boolean> {
  try {
    const keytar = await import(KEYTAR).catch(() => null);
    if (!keytar) return false;
    const mod = (keytar as { default?: unknown }).default ?? keytar;
    const setPassword = (mod as { setPassword?: unknown }).setPassword;
    if (typeof setPassword !== "function") return false;
    await setPassword(SERVICE, provider, key);
    return true;
  } catch {
    return false;
  }
}

export async function hasKey(provider: string): Promise<boolean> {
  return (await loadKey(provider)) !== null;
}
