// core/skills/registry.ts
// Capability diff na importação: ao trazer uma skill de fora, mostra exatamente o
// que o manifesto pede vs o que a superfície concede — campo a campo. O usuário
// concede ou nega (ao contrário do tudo-ou-nada que vazou na Cisco). O que não está
// no grant é o que precisa de aprovação explícita.

import type { CapabilityManifest } from "./types.js";

/** Forma estrutural de um grant de capacidade (compatível com o CapabilityGrant da
 *  Engine, sem importar @typer/engine — evita ciclo). */
export interface GrantLike {
  permissions: readonly string[];
  exec: readonly string[];
  tools?: { allow?: readonly string[]; deny?: readonly string[] };
}

export interface CapabilityDiff {
  /** tudo que o manifesto pede */
  requested: { tools: string[]; permissions: string[]; exec: string[]; network: string[] };
  /** o que o grant NÃO cobre (precisa de aprovação explícita) */
  notGranted: { tools: string[]; permissions: string[]; exec: string[] };
  /** true se o grant já cobre tudo que o manifesto pede */
  clean: boolean;
}

/** Compara o manifesto da skill contra o grant da superfície. */
export function capabilityDiff(manifest: CapabilityManifest | undefined, grant: GrantLike): CapabilityDiff {
  const m = manifest ?? {};
  const reqTools = m.tools ?? [];
  const reqPerms = m.permissions ?? [];
  const reqExec = m.exec ?? [];
  const reqNet = m.network ?? [];

  const allow = grant.tools?.allow;
  const deny = grant.tools?.deny ?? [];
  const ngTools = reqTools.filter((t) => deny.includes(t) || (allow !== undefined && !allow.includes(t)));
  const ngPerms = reqPerms.filter((p) => !grant.permissions.includes(p));
  const ngExec = reqExec.filter((e) => !grant.exec.includes(e));

  return {
    requested: { tools: [...reqTools], permissions: [...reqPerms], exec: [...reqExec], network: [...reqNet] },
    notGranted: { tools: ngTools, permissions: ngPerms, exec: ngExec },
    clean: ngTools.length === 0 && ngPerms.length === 0 && ngExec.length === 0,
  };
}

/** O grant efetivo de uma skill = o MENOR entre o grant da superfície e o manifesto
 *  (capability downgrade): uma skill que não declarou rede não recebe rede. */
export function effectiveGrant(manifest: CapabilityManifest | undefined, grant: GrantLike): GrantLike {
  if (!manifest) return grant;
  const perms = manifest.permissions
    ? grant.permissions.filter((p) => manifest.permissions!.includes(p as never))
    : grant.permissions;
  const exec = manifest.exec
    ? grant.exec.filter((e) => manifest.exec!.includes(e as never))
    : grant.exec;
  const allow = manifest.tools ? manifest.tools : grant.tools?.allow;
  return {
    permissions: perms,
    exec,
    ...(allow ? { tools: { allow, ...(grant.tools?.deny ? { deny: grant.tools.deny } : {}) } } : {}),
  };
}
