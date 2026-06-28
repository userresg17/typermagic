// core/router/route.ts
// Roteamento como função pura do tipo de tarefa mais a política, então testável
// isolado. A política manda autocomplete para um modelo FIM rápido e o agente
// para um modelo forte; o usuário pode forçar override por tarefa (subfase 2.4).

import type { Provider } from "./provider.js";

export type Task = "autocomplete" | "agent" | "chat";

/** A política de roteamento é DADO, configurável, não código espalhado. */
export interface RoutingPolicy {
  /** modelo escolhido por tarefa */
  models: Record<Task, string>;
  /** provider preferido por tarefa; ausência cai no defaultProvider */
  providers: Partial<Record<Task, string>>;
  defaultProvider: string;
}

// Haiku para latência baixa, Opus para raciocínio forte.
export const DEFAULT_POLICY: RoutingPolicy = {
  models: {
    autocomplete: "claude-haiku-4-5",
    agent: "claude-opus-4-8",
    chat: "claude-opus-4-8",
  },
  providers: {},
  defaultProvider: "anthropic",
};

/** Escolhe o modelo pela tarefa. O override do usuário tem prioridade. */
export function pickModel(
  task: Task,
  override?: string,
  policy: RoutingPolicy = DEFAULT_POLICY,
): string {
  return override ?? policy.models[task];
}

/**
 * Escolhe o provider pela tarefa. Ordem: override > política por tarefa >
 * defaultProvider. Cai no primeiro registrado se o escolhido não existe.
 */
export function route(
  task: Task,
  providers: Record<string, Provider>,
  override?: string,
  policy: RoutingPolicy = DEFAULT_POLICY,
): Provider {
  const preferred =
    override ?? policy.providers[task] ?? policy.defaultProvider;
  const chosen = providers[preferred] ?? Object.values(providers)[0];
  if (!chosen) throw new Error("Nenhum provider registrado no router.");
  return chosen;
}
