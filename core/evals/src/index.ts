// core/evals/index.ts — superfície pública do pacote @typer/evals

export { runEvals } from "./evals.js";
export type {
  EvalCase,
  EvalCheck,
  EvalResult,
  EvalSummary,
  RunEvalsOptions,
} from "./evals.js";
export { Metrics } from "./metrics.js";
export type { MetricsSnapshot, TimingStats } from "./metrics.js";
export { Telemetry } from "./telemetry.js";
export type { TelemetryEvent, TelemetrySink, TelemetryOptions } from "./telemetry.js";
