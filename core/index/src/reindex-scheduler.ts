// core/index/reindex-scheduler.ts
// Agenda reindexação em segundo plano com debounce e backpressure, como manda a
// seção de Concorrência da arquitetura: edições rápidas coalescem numa janela
// curta; um arquivo ocupa um slot só, e um save novo durante a reindexação
// re-enfileira em vez de rodar em paralelo. Nunca trava a edição.

export interface ReindexSchedulerOptions {
  debounceMs?: number;
}

export class ReindexScheduler {
  private readonly debounceMs: number;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<string>();
  private readonly queued = new Set<string>();

  constructor(
    private readonly reindex: (file: string) => Promise<unknown>,
    opts: ReindexSchedulerOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 300;
  }

  /** Agenda a reindexação de um arquivo. Coalesce edições dentro do debounce. */
  schedule(file: string): void {
    const existing = this.timers.get(file);
    if (existing) clearTimeout(existing);
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        void this.run(file);
      }, this.debounceMs),
    );
  }

  private async run(file: string): Promise<void> {
    // backpressure: 1 slot por arquivo. Save novo durante a corrida re-enfileira.
    if (this.inFlight.has(file)) {
      this.queued.add(file);
      return;
    }
    this.inFlight.add(file);
    try {
      await this.reindex(file);
    } finally {
      this.inFlight.delete(file);
      if (this.queued.delete(file)) void this.run(file);
    }
  }

  /** Cancela timers pendentes (ex.: shutdown). */
  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  get pendingCount(): number {
    return this.timers.size;
  }
}
