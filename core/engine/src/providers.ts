// core/engine/providers.ts
// Construção do provider para uma tarefa: BYOK (env/keychain) → providers → roteamento
// por tarefa → medidor de custo como middleware (toda chamada passa por ele). Reusa
// @typer/router (buildProviders/route/modelFor) e @typer/cost (CostMeter/MeteredProvider),
// já compartilhados entre CLI e Typer Core Server.

import {
  buildProviders,
  route,
  modelFor,
  type Provider,
  type Task,
} from "@typer/router";
import { CostMeter, MeteredProvider } from "@typer/cost";

export interface ProviderBundle {
  provider: Provider;
  model: string;
  online: boolean;
  meter: CostMeter;
}

export async function buildEngineProvider(opts: {
  local: boolean;
  provider: string | null;
  model: string | null;
  task: Task;
}): Promise<ProviderBundle> {
  const { providers, preferred, online } = await buildProviders(opts.local, opts.provider);
  const meter = new CostMeter();
  const provider = new MeteredProvider(route(opts.task, providers, preferred), meter, opts.task);
  const model = modelFor(preferred, opts.task, opts.model);
  return { provider, model, online, meter };
}
