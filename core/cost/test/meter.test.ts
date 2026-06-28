import { describe, it, expect } from "vitest";
import { computeCost, CostMeter } from "../src/meter.js";

describe("computeCost", () => {
  it("calcula custo de entrada e saída para Opus 4.8", () => {
    // 1M in @ $5, 1M out @ $25
    const c = computeCost("claude-opus-4-8", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c.input).toBeCloseTo(5, 6);
    expect(c.output).toBeCloseTo(25, 6);
    expect(c.total).toBeCloseTo(30, 6);
  });

  it("usa preço do Haiku para autocomplete", () => {
    const c = computeCost("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(c.input).toBeCloseTo(1, 6);
  });

  it("aplica o multiplicador de leitura de cache (0,1x)", () => {
    const c = computeCost("claude-opus-4-8", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(c.cache).toBeCloseTo(0.5, 6); // 5 * 0.1
  });

  it("modelo desconhecido (local) custa zero", () => {
    const c = computeCost("llama-local", {
      inputTokens: 10_000,
      outputTokens: 10_000,
    });
    expect(c.total).toBe(0);
  });
});

describe("CostMeter", () => {
  it("acumula um ledger e soma os totais", () => {
    const m = new CostMeter();
    m.record("anthropic", "claude-opus-4-8", {
      inputTokens: 500_000,
      outputTokens: 100_000,
    });
    m.record("anthropic", "claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(m.ledger()).toHaveLength(2);
    const { usage, cost } = m.totals();
    expect(usage.inputTokens).toBe(1_500_000);
    expect(usage.outputTokens).toBe(100_000);
    // opus: 0.5*5 + 0.1*25 = 2.5 + 2.5 = 5 ; haiku: 1*1 = 1 -> 6
    expect(cost.total).toBeCloseTo(6, 6);
  });

  it("formata USD de forma compacta", () => {
    expect(CostMeter.formatUSD(0)).toBe("$0");
    expect(CostMeter.formatUSD(0.0012)).toBe("$0.0012");
    expect(CostMeter.formatUSD(1.5)).toBe("$1.50");
  });
});
