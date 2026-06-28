// core/engine/event-queue.ts
// Ponte entre as APIs do núcleo, que são orientadas a callback (runEditLoop chama
// beforeSeal/afterSeal durante o await), e o stream de eventos da Engine, que é um
// async generator. Os callbacks empurram (push) eventos; o runTask drena (drain)
// enquanto o trabalho roda. Fila de consumidor único — basta para o caso da Engine.

export class EventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  /** Empurra um evento; se há um consumidor esperando, entrega direto. */
  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  /** Fecha a fila; consumidores pendentes recebem done. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    let waiter: ((r: IteratorResult<T>) => void) | undefined;
    while ((waiter = this.waiters.shift())) {
      waiter({ value: undefined as never, done: true });
    }
  }

  /** Drena a fila até ela fechar. Um único consumidor. */
  async *drain(): AsyncGenerator<T> {
    while (true) {
      const buffered = this.items.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
