// core/seal/seal.ts
// O selo: o único portão de escrita. Aplica o plano, roda a suíte do projeto e
// decide. Passou -> Verificado, a mudança fica. Falhou -> Rejeitado, reverte e
// nada fica no disco. Estado inicial é Rejeitado, por construção.

import { writePlan, type FilePlan } from "@typer/edit";
import { runTests } from "./runner.js";
import { revertPlans } from "./revert.js";
import type { SealConfig, SealResult } from "./types.js";

export class Seal {
  /** Verifica um plano de edição contra a suíte. Aplica, testa, mantém ou
   *  reverte. */
  async verify(plans: FilePlan[], cfg: SealConfig): Promise<SealResult> {
    const start = Date.now();
    const ok = plans.filter((p) => p.status !== "error");

    if (ok.length === 0) {
      return {
        state: "Rejeitado",
        passed: false,
        output: "",
        durationMs: Date.now() - start,
        reverted: [],
        reason: "Nada a aplicar: todos os blocos falharam no plano.",
      };
    }

    const applied = await writePlan(cfg.root, ok);
    const appliedPlans = ok.filter((p) => applied.includes(p.file));

    const run = await runTests(cfg.root, cfg.testCommand, {
      ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
    });

    if (run.code === 0) {
      return {
        state: "Verificado",
        passed: true,
        output: run.output,
        durationMs: Date.now() - start,
        applied,
      };
    }

    const reverted = await revertPlans(cfg.root, appliedPlans);
    const reason = run.timedOut
      ? "Suíte estourou o tempo limite."
      : run.code === -1
        ? "Comando de teste não pôde ser executado."
        : `Suíte falhou (exit ${run.code}).`;

    return {
      state: "Rejeitado",
      passed: false,
      output: run.output,
      durationMs: Date.now() - start,
      reverted,
      reason,
    };
  }
}
