// core/evals/evals.ts
// Harness de avaliação: roda um conjunto de casos por um runner e resume o
// resultado (pass rate, por caso). Genérico — serve para avaliar o loop do
// agente, a recuperação, o selo, qualquer componente.

export interface EvalCheck {
  pass: boolean;
  detail?: string;
}

export interface EvalCase<I = unknown, O = unknown> {
  name: string;
  input: I;
  check: (output: O) => boolean | EvalCheck;
}

export interface EvalResult {
  name: string;
  pass: boolean;
  detail?: string;
  durationMs: number;
  error?: string;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: EvalResult[];
}

export interface RunEvalsOptions {
  now?: () => number;
}

function normalize(c: boolean | EvalCheck): EvalCheck {
  return typeof c === "boolean" ? { pass: c } : c;
}

export async function runEvals<I, O>(
  cases: EvalCase<I, O>[],
  run: (input: I) => Promise<O> | O,
  opts: RunEvalsOptions = {},
): Promise<EvalSummary> {
  const now = opts.now ?? (() => Date.now());
  const results: EvalResult[] = [];

  for (const c of cases) {
    const start = now();
    try {
      const output = await run(c.input);
      const check = normalize(c.check(output));
      results.push({
        name: c.name,
        pass: check.pass,
        ...(check.detail !== undefined ? { detail: check.detail } : {}),
        durationMs: now() - start,
      });
    } catch (err) {
      results.push({
        name: c.name,
        pass: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: now() - start,
      });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    results,
  };
}
