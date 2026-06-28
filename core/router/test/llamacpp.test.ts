import { describe, it, expect, vi, afterEach } from "vitest";
import { LlamaCppProvider } from "../src/llamacpp.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + "\n"));
      c.close();
    },
  });
}

describe("LlamaCppProvider", () => {
  it("fim chama /infill (prefix+suffix) e devolve content", async () => {
    let body: unknown;
    globalThis.fetch = vi.fn(async (_url, opts) => {
      body = JSON.parse((opts as { body: string }).body);
      return { ok: true, json: async () => ({ content: "a + b" }) } as Response;
    }) as typeof fetch;

    const p = new LlamaCppProvider();
    const out = await p.fim({ prefix: "def soma(a, b):\n  return ", suffix: "\n", model: "local" });
    expect(out).toBe("a + b");
    expect(body).toMatchObject({ input_prefix: expect.stringContaining("def soma"), input_suffix: "\n" });
  });

  it("fim injeta o contexto no prefixo", async () => {
    let body: { input_prefix?: string } = {};
    globalThis.fetch = vi.fn(async (_url, opts) => {
      body = JSON.parse((opts as { body: string }).body);
      return { ok: true, json: async () => ({ content: "x" }) } as Response;
    }) as typeof fetch;
    const p = new LlamaCppProvider();
    await p.fim({ prefix: "P", suffix: "S", model: "local", context: "// ctx" });
    expect(body.input_prefix).toContain("// ctx");
  });

  it("chat faz streaming do SSE OpenAI-compat", async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        body: sseBody([
          'data: {"choices":[{"delta":{"content":"olá"}}]}',
          'data: {"choices":[{"delta":{"content":" mundo"}}]}',
          "data: [DONE]",
        ]),
      } as unknown as Response;
    }) as typeof fetch;

    const p = new LlamaCppProvider();
    let text = "";
    for await (const c of p.chat({ messages: [{ role: "user", content: "oi" }], model: "local" })) {
      text += c.text;
    }
    expect(text).toBe("olá mundo");
  });

  it("erro HTTP vira exceção clara", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }) as Response) as typeof fetch;
    const p = new LlamaCppProvider();
    await expect(p.fim({ prefix: "a", suffix: "b", model: "local" })).rejects.toThrow(/llama.cpp infill 500/);
  });
});
