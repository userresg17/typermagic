// app/agent-cli/src/host.ts
// Host de aprovação (HITL) no terminal: a Engine pede, o usuário decide. --yes
// auto-aprova; sem TTY, nega (nunca aplica sem confirmação explícita).

import { createInterface } from "node:readline/promises";
import type { EngineHost } from "@typer/engine";
import type { ApprovalRequest } from "@typer/agent";

function questionFor(req: ApprovalRequest): string {
  if (req.action === "seal") return `Aplicar e selar (${req.target})? [s/N] `;
  if (req.action === "apply") return `Aplicar estas mudanças? [s/N] `;
  if (req.action === "tool") return `Executar ${req.target}? [s/N] `;
  return `Aprovar ${req.action} (${req.target})? [s/N] `;
}

export function makeHost(yes: boolean): EngineHost {
  return {
    approve: async (req) => {
      if (yes) return true;
      if (!process.stdin.isTTY) return false;
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const ans = (await rl.question(questionFor(req))).trim().toLowerCase();
      rl.close();
      return ans === "s" || ans === "sim" || ans === "y" || ans === "yes";
    },
  };
}
