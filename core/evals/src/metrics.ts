// core/evals/metrics.ts
// Recorder de métricas por caminho (indexação, autocomplete, cache...). A
// métrica afina o threshold, não troca a estratégia — então o objetivo é
// instrumentar barato e ler depois.

export interface TimingStats {
  count: number;
  avg: number;
  p50: number;
  max: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  timings: Record<string, TimingStats>;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  timing(name: string, ms: number): void {
    const arr = this.timings.get(name) ?? [];
    arr.push(ms);
    this.timings.set(name, arr);
  }

  /** Mede a duração de uma função e registra na métrica. */
  async time<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.timing(name, this.now() - start);
    }
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;

    const timings: Record<string, TimingStats> = {};
    for (const [k, arr] of this.timings) {
      const sorted = [...arr].sort((a, b) => a - b);
      const sum = sorted.reduce((s, x) => s + x, 0);
      timings[k] = {
        count: sorted.length,
        avg: sorted.length ? sum / sorted.length : 0,
        p50: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0,
        max: sorted.length ? sorted[sorted.length - 1]! : 0,
      };
    }
    return { counters, timings };
  }
}
