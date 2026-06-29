// core/reach/router.ts
// O motor de roteamento com fallback: tenta os backends de um canal em ordem; o 1º
// que devolver ok vence. Se todos falharem, junta os erros num resultado estruturado.

import type { Backend, Channel, ProbeStatus, ReachContext, ReachResult } from "./types.js";
import { FEATURE_REQUIREMENTS } from "./types.js";

/** Tenta os backends em ordem; o 1º ok vence. Backends indisponíveis são pulados. */
export async function tryBackends(
  backends: Backend[],
  input: string,
  ctx: ReachContext,
): Promise<ReachResult> {
  const errors: string[] = [];
  for (const b of backends) {
    try {
      if (!(await b.available(ctx))) {
        errors.push(`${b.name}: indisponível`);
        continue;
      }
      const r = await b.run(input, ctx);
      if (r.ok) return { ...r, backend: b.name };
      errors.push(`${b.name}: ${r.error?.message ?? "falhou"}`);
    } catch (e) {
      errors.push(`${b.name}: ${(e as Error).message}`);
    }
  }
  return {
    ok: false,
    error: { code: "all_backends_failed", message: errors.join(" | ") || "nenhum backend" },
  };
}

/** Lê/baixa via um canal (cadeia de fallback dos seus backends). */
export function fetchVia(channel: Channel, input: string, ctx: ReachContext): Promise<ReachResult> {
  return tryBackends(channel.backends, input, ctx);
}

/** Auto-checagem de um canal p/ o doctor: o 1º backend disponível define o status. */
export async function probeChannel(channel: Channel, ctx: ReachContext): Promise<ProbeStatus> {
  for (const b of channel.backends) {
    try {
      if (b.probeReliable === false) continue; // best-effort: não prova prontidão
      if (await b.available(ctx)) {
        return { status: "ok", message: `pronto`, activeBackend: b.name };
      }
    } catch {
      /* backend com erro de checagem: tenta o próximo */
    }
  }
  const needs = FEATURE_REQUIREMENTS[channel.name];
  return needs
    ? { status: "needs-config", message: `precisa de: ${needs.join(", ")}` }
    : { status: "unavailable", message: "nenhum backend disponível" };
}
