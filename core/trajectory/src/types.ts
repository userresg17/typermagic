// core/trajectory/types.ts
// Uma trajetória é o rastro reproduzível de uma tarefa do agente: prompt, passos
// (tool calls, plano, selo, aprovação, política, auditoria), desfecho e custo. Sem
// timestamps reais (usa o índice do passo) → duas máquinas que rodam a mesma tarefa
// produzem a mesma forma canônica, e a assinatura é verificável. Serve auditoria,
// debugging e treino (dataset).

export interface TrajectoryStep {
  type: string;
  /** índice do passo no stream (determinístico, sem relógio) */
  at: number;
  data: Record<string, unknown>;
}

export interface Trajectory {
  id: string;
  prompt: string;
  steps: TrajectoryStep[];
  outcome: unknown;
  cost?: { inputTokens: number; outputTokens: number; usd: number | null };
  /** id da chave do publisher (ed25519:...) */
  publisher?: string;
  /** assinatura Ed25519 da forma canônica (prompt+steps+outcome+cost) */
  signature?: string;
  /** hash de integridade (sha256 curto) */
  hash?: string;
}

/** Evento solto (estruturalmente compatível com EngineEvent) — o recorder não
 *  importa @typer/engine p/ não criar ciclo. */
export type TrajectoryEvent = { type: string } & Record<string, unknown>;
