// core/engine/seal-router.ts
// Selo generalizado por classe de ação. O selo de código já existe (@typer/seal:
// aplica o plano, roda a suíte, mantém ou reverte). Aqui ele vira o ramo "code" de
// um roteador que, nas fases seguintes, ganha os ramos de efeito externo:
//   - reversível/baixo impacto → política + dry-run (Fase 3);
//   - irreversível/alto impacto → selo humano (ApprovalGate, que já existe).
// A máquina de estados Rejeitado→Juízo→Verificado é a mesma; o dispatch das 50
// ferramentas já delega a ctx.seal, então ligar os outros ramos depois não toca
// ferramenta nem a Engine API. Na fundação só o ramo de código está ligado.

import { Seal, type SealConfig, type SealResult } from "@typer/seal";
import type { FilePlan } from "@typer/edit";

export type ActionClass = "code" | "external-reversible" | "external-irreversible";

export interface SealRouterOptions {
  root: string;
  testCommand: string | string[];
  timeoutMs?: number;
  /** injetável para teste; default new Seal() */
  seal?: Seal;
}

export class SealRouter {
  private readonly seal: Seal;
  private readonly cfg: SealConfig;

  constructor(opts: SealRouterOptions) {
    this.seal = opts.seal ?? new Seal();
    this.cfg = {
      root: opts.root,
      testCommand: opts.testCommand,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    };
  }

  /** Classe da ação. Fundação: tudo que carrega um plano de edição é "code".
   *  As classes de efeito externo entram quando o gateway/scheduler existir. */
  classify(action: { kind: "code" } | { kind: "external"; reversible: boolean }): ActionClass {
    if (action.kind === "code") return "code";
    return action.reversible ? "external-reversible" : "external-irreversible";
  }

  /** O ramo de código: o selo que já existe. */
  async verifyCode(plans: FilePlan[]): Promise<SealResult> {
    return this.seal.verify(plans, this.cfg);
  }

  /** Verificador no formato que o ToolContext.seal espera (dispatch das 50
   *  ferramentas). O handler de escrita produz o plano em result.value; aqui o
   *  selo aplica→testa→mantém/reverte e devolve só se passou. */
  toolVerifier(): { verify: (diff: unknown) => Promise<{ passed: boolean }> } {
    return {
      verify: async (diff: unknown) => {
        const plans = Array.isArray(diff) ? (diff as FilePlan[]) : [];
        const result = await this.seal.verify(plans, this.cfg);
        return { passed: result.passed };
      },
    };
  }
}
