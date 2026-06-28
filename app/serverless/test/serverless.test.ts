import { describe, it, expect } from "vitest";
import { handleTask, lambdaHandler } from "../src/handler.js";

describe("serverless handleTask (offline fake)", () => {
  it("roda a tarefa e devolve texto + outcome", async () => {
    const res = await handleTask({ prompt: "explique BYOK", provider: "fake" });
    expect(res.text).toContain("eco: explique BYOK");
    expect((res.outcome as { state: string }).state).toBe("Respondido");
  });

  it("lambdaHandler embrulha em statusCode/body", async () => {
    const r = await lambdaHandler({ body: JSON.stringify({ prompt: "oi", provider: "fake" }) });
    expect(r.statusCode).toBe(200);
    const parsed = JSON.parse(r.body) as { text: string };
    expect(parsed.text).toContain("eco: oi");
  });
});
