// app/gateway/rate-limit.ts
// Token bucket por remetente: cada um tem um balde que reabastece com o tempo.
// Mensagem consome um token; sem token → recusada. Protege contra flood de um canal.

interface Bucket {
  tokens: number;
  last: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity = 5,
    private readonly refillMs = 4000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Tenta consumir um token do remetente. true = liberado. */
  allow(sender: string): boolean {
    const t = this.now();
    const b = this.buckets.get(sender) ?? { tokens: this.capacity, last: t };
    // reabastece pelo tempo decorrido
    const refill = Math.floor((t - b.last) / this.refillMs);
    if (refill > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + refill);
      b.last = t;
    }
    if (b.tokens <= 0) {
      this.buckets.set(sender, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(sender, b);
    return true;
  }
}
