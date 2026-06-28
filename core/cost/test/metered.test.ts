import { describe, it, expect } from "vitest";
import { FakeProvider } from "@typer/router";
import { CostMeter } from "../src/meter.js";
import { MeteredProvider } from "../src/metered.js";

describe("MeteredProvider", () => {
  it("registra o uso ao consumir o stream de chat", async () => {
    const meter = new CostMeter();
    const metered = new MeteredProvider(new FakeProvider(), meter, "chat");

    let out = "";
    for await (const chunk of metered.chat({
      messages: [{ role: "user", content: "olá" }],
      model: "claude-opus-4-8",
    })) {
      out += chunk.text;
    }

    expect(out).toBe("eco: olá");
    const ledger = meter.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.model).toBe("claude-opus-4-8");
    expect(ledger[0]!.task).toBe("chat");
    expect(ledger[0]!.usage.outputTokens).toBeGreaterThan(0);
    expect(ledger[0]!.cost.total).toBeGreaterThan(0);
  });

  it("preserva o id e delega countTokens/fim ao provider interno", async () => {
    const metered = new MeteredProvider(new FakeProvider(), new CostMeter());
    expect(metered.id).toBe("fake");
    expect(metered.countTokens("abcd")).toBe(1);
    expect(await metered.fim({ prefix: "", suffix: "", model: "x" })).toBe(
      "/* fim */",
    );
  });
});
