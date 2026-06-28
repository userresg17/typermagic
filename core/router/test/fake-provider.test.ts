import { describe, it, expect } from "vitest";
import { FakeProvider } from "../src/fake-provider.js";

describe("FakeProvider", () => {
  const fake = new FakeProvider();

  it("ecoa a última mensagem em pedaços de streaming", async () => {
    let out = "";
    for await (const chunk of fake.chat({
      messages: [{ role: "user", content: "olá mundo" }],
      model: "x",
    })) {
      out += chunk.text;
    }
    expect(out).toBe("eco: olá mundo");
  });

  it("conta tokens por aproximação de 4 chars", () => {
    expect(fake.countTokens("abcd")).toBe(1);
    expect(fake.countTokens("abcdefgh")).toBe(2);
  });
});
