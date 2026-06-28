// core/cost/meter.ts
// O medidor de custo. Estima e registra custo por requisição, e acumula um
// ledger. Função pura de custo (computeCost) separada do acumulador, então é
// testável isolada.

import { priceFor, CACHE } from "./pricing.js";
import type { Cost, LedgerEntry, Usage } from "./types.js";

const PER_MILLION = 1_000_000;

/** Calcula o custo em USD de um uso, dado o modelo. Pura. */
export function computeCost(model: string, usage: Usage): Cost {
  const p = priceFor(model);
  const input = (usage.inputTokens / PER_MILLION) * p.input;
  const output = (usage.outputTokens / PER_MILLION) * p.output;
  const cacheRead =
    ((usage.cacheReadTokens ?? 0) / PER_MILLION) * p.input * CACHE.read;
  const cacheWrite =
    ((usage.cacheWriteTokens ?? 0) / PER_MILLION) * p.input * CACHE.write5m;
  const cache = cacheRead + cacheWrite;
  return { input, output, cache, total: input + output + cache };
}

export class CostMeter {
  private readonly entries: LedgerEntry[] = [];

  /** Registra um uso real e devolve a entrada criada. */
  record(
    provider: string,
    model: string,
    usage: Usage,
    task?: string,
  ): LedgerEntry {
    const cost = computeCost(model, usage);
    const entry: LedgerEntry = task
      ? { provider, model, task, usage, cost }
      : { provider, model, usage, cost };
    this.entries.push(entry);
    return entry;
  }

  /** Estima o custo de um uso antes da chamada, sem registrar. */
  estimate(model: string, usage: Usage): Cost {
    return computeCost(model, usage);
  }

  ledger(): readonly LedgerEntry[] {
    return this.entries;
  }

  totals(): { usage: Usage; cost: Cost } {
    const usage: Usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const cost: Cost = { input: 0, output: 0, cache: 0, total: 0 };
    for (const e of this.entries) {
      usage.inputTokens += e.usage.inputTokens;
      usage.outputTokens += e.usage.outputTokens;
      usage.cacheReadTokens =
        (usage.cacheReadTokens ?? 0) + (e.usage.cacheReadTokens ?? 0);
      usage.cacheWriteTokens =
        (usage.cacheWriteTokens ?? 0) + (e.usage.cacheWriteTokens ?? 0);
      cost.input += e.cost.input;
      cost.output += e.cost.output;
      cost.cache += e.cost.cache;
      cost.total += e.cost.total;
    }
    return { usage, cost };
  }

  /** Formata um custo em USD para exibição compacta. */
  static formatUSD(usd: number): string {
    if (usd === 0) return "$0";
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }
}
