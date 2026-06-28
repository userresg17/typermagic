import { describe, it, expect } from "vitest";
import { runEvals, type EvalCase } from "../src/evals.js";
import { Metrics } from "../src/metrics.js";
import { Telemetry } from "../src/telemetry.js";

describe("runEvals", () => {
  it("roda casos e resume o pass rate", async () => {
    const cases: EvalCase<number, number>[] = [
      { name: "dobro de 2", input: 2, check: (o) => o === 4 },
      { name: "dobro de 3", input: 3, check: (o) => o === 6 },
      { name: "errado de propósito", input: 5, check: (o) => o === 999 },
    ];
    const summary = await runEvals(cases, (n) => n * 2);
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.passRate).toBeCloseTo(2 / 3, 6);
  });

  it("conta um runner que estoura como falha, com a mensagem", async () => {
    const cases: EvalCase<number, number>[] = [
      { name: "estoura", input: 1, check: () => true },
    ];
    const summary = await runEvals(cases, () => {
      throw new Error("boom");
    });
    expect(summary.passed).toBe(0);
    expect(summary.results[0]!.error).toBe("boom");
  });

  it("aceita EvalCheck com detalhe", async () => {
    const summary = await runEvals(
      [{ name: "c", input: 0, check: () => ({ pass: false, detail: "faltou X" }) }],
      (x: number) => x,
    );
    expect(summary.results[0]!.detail).toBe("faltou X");
  });
});

describe("Metrics", () => {
  it("conta, cronometra e resume", async () => {
    let t = 0;
    const m = new Metrics(() => (t += 5)); // cada chamada +5ms
    m.increment("reindex");
    m.increment("reindex", 2);
    m.timing("fim.latency", 100);
    m.timing("fim.latency", 200);
    const snap = m.snapshot();
    expect(snap.counters.reindex).toBe(3);
    expect(snap.timings["fim.latency"]!.count).toBe(2);
    expect(snap.timings["fim.latency"]!.avg).toBe(150);
    expect(snap.timings["fim.latency"]!.max).toBe(200);
  });
});

describe("Telemetry", () => {
  it("é no-op por padrão (desligada)", () => {
    const t = new Telemetry();
    t.track("app.start");
    expect(t.isEnabled).toBe(false);
    expect(t.events()).toEqual([]);
  });

  it("só coleta e envia com consentimento ativo", () => {
    const sent: string[] = [];
    const t = new Telemetry({
      sink: (e) => sent.push(e.name),
      clock: () => Date.parse("2026-06-26T12:00:00Z"),
    });
    t.track("antes"); // ignorado
    t.enable();
    t.track("depois", { ok: true });
    expect(t.events().map((e) => e.name)).toEqual(["depois"]);
    expect(sent).toEqual(["depois"]);
  });
});
