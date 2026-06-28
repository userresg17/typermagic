// core/evals/telemetry.ts
// Telemetria opt-in (6.4). Desligada por padrão; só registra/envia com
// consentimento ativo. Não existe nuvem Typer: o sink é injetado pelo usuário,
// e sem consentimento track() é no-op.

export interface TelemetryEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
  at: string;
}

export type TelemetrySink = (event: TelemetryEvent) => void;

export interface TelemetryOptions {
  /** precisa ser true explicitamente; default false (desligada) */
  enabled?: boolean;
  sink?: TelemetrySink;
  clock?: () => number;
}

export class Telemetry {
  private enabled: boolean;
  private readonly sink: TelemetrySink | undefined;
  private readonly clock: () => number;
  private readonly buffer: TelemetryEvent[] = [];

  constructor(opts: TelemetryOptions = {}) {
    this.enabled = opts.enabled ?? false;
    this.sink = opts.sink;
    this.clock = opts.clock ?? (() => Date.now());
  }

  /** Consentimento ativo: liga a coleta. */
  enable(): void {
    this.enabled = true;
  }
  disable(): void {
    this.enabled = false;
  }
  get isEnabled(): boolean {
    return this.enabled;
  }

  track(name: string, props?: TelemetryEvent["props"]): void {
    if (!this.enabled) return; // sem consentimento, nada acontece
    const event: TelemetryEvent = {
      name,
      ...(props ? { props } : {}),
      at: new Date(this.clock()).toISOString(),
    };
    this.buffer.push(event);
    this.sink?.(event);
  }

  /** Eventos coletados nesta sessão (vazio quando desligada). */
  events(): readonly TelemetryEvent[] {
    return this.buffer;
  }
}
