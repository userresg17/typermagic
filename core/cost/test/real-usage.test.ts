import { describe, it, expect } from "vitest";
import type { Provider, ChatRequest, Chunk } from "@typer/router";
import { CostMeter } from "../src/meter.js";
import { MeteredProvider } from "../src/metered.js";

// Provider que reporta uso REAL no chunk final, como o Anthropic faz.
class UsageProvider implements Provider {
  readonly id = "usage";
  async *chat(_req: ChatRequest): AsyncIterable<Chunk> {
    yield { text: "ola" };
    yield {
      text: "",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
      },
    };
  }
  async fim() {
    return "";
  }
  countTokens(t: string) {
    return t.length;
  }
}

describe("MeteredProvider — uso real", () => {
  it("registra o uso reportado pelo provider em vez de estimar", async () => {
    const meter = new CostMeter();
    const metered = new MeteredProvider(new UsageProvider(), meter, "chat");
    for await (const _ of metered.chat({
      messages: [{ role: "user", content: "oi" }],
      model: "claude-opus-4-8",
      cache: true,
    })) {
      void _;
    }
    const e = meter.ledger()[0]!;
    expect(e.usage.inputTokens).toBe(1000);
    expect(e.usage.outputTokens).toBe(200);
    expect(e.usage.cacheReadTokens).toBe(800);
    // custo inclui o cache lido a 0,1x do input
    expect(e.cost.cache).toBeGreaterThan(0);
  });
});
