// core/reach/doctor.ts
// "doctor": checa cada canal (sobrevive a erro por-canal) e formata o relatório.
// Espelha o doctor.py do agent-reach.

import type { ProbeStatus, ReachContext } from "./types.js";
import { CHANNELS } from "./registry.js";
import { probeChannel } from "./router.js";

export interface ChannelReport extends ProbeStatus {
  name: string;
  description: string;
  tier: string;
  backends: string[];
}

export async function checkAll(ctx: ReachContext): Promise<ChannelReport[]> {
  // Probes em paralelo: canais são independentes (domínios distintos) e a soma
  // sequencial passava de 40s; em paralelo o doctor custa ~o probe mais lento.
  // A ordem do relatório continua a de CHANNELS (map preserva o índice).
  return Promise.all(
    CHANNELS.map(async (c) => {
      let s: ProbeStatus;
      try {
        s = await probeChannel(c, ctx);
      } catch (e) {
        s = { status: "unavailable", message: `erro de checagem: ${(e as Error).message}` };
      }
      return { name: c.name, description: c.description, tier: c.tier, backends: c.backends.map((b) => b.name), ...s };
    }),
  );
}

export function formatReport(reports: ChannelReport[]): string {
  const icon = (s: string) => (s === "ok" ? "✓" : s === "needs-config" ? "!" : "·");
  const lines = reports.map(
    (r) =>
      `${icon(r.status)} ${r.name.padEnd(9)} ${r.description.padEnd(34)} ${r.message}${
        r.activeBackend ? `  [${r.activeBackend}]` : ""
      }`,
  );
  const ok = reports.filter((r) => r.status === "ok").length;
  return [`reach — ${ok}/${reports.length} canais prontos`, ...lines].join("\n");
}
