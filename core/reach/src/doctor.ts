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
  const out: ChannelReport[] = [];
  for (const c of CHANNELS) {
    let s: ProbeStatus;
    try {
      s = await probeChannel(c, ctx);
    } catch (e) {
      s = { status: "unavailable", message: `erro de checagem: ${(e as Error).message}` };
    }
    out.push({ name: c.name, description: c.description, tier: c.tier, backends: c.backends.map((b) => b.name), ...s });
  }
  return out;
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
