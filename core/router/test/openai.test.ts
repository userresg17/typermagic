import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { OpenAIProvider } from "../src/openai.js";

function sseStream(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n`));
      }
      controller.enqueue(enc.encode("data: [DONE]\n"));
      controller.close();
    },
  });
}

const KEY = "TYPER_OPENAI_KEY";
let original: string | undefined;
beforeEach(() => {
  original = process.env[KEY];
  process.env[KEY] = "sk-openai-teste";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("OpenAIProvider.chat", () => {
  it("faz streaming e captura uso, incl. tokens cacheados", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: sseStream([
        { choices: [{ delta: { content: "ola" } }] },
        { choices: [{ delta: { content: " mundo" } }] },
        {
          choices: [{ delta: {} }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 80 },
          },
        },
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new OpenAIProvider();
    let text = "";
    let usage: unknown;
    for await (const c of p.chat({
      messages: [{ role: "user", content: "oi" }],
      model: "gpt-4.1",
      system: "instrução",
    })) {
      text += c.text;
      if (c.usage) usage = c.usage;
    }
    expect(text).toBe("ola mundo");
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
    });

    // envia Bearer e o system como primeira mensagem
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).authorization).toMatch(
      /^Bearer /,
    );
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "instrução" });
  });

  it("faz FIM via prompt instruído", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "a, b" } }] }),
      })),
    );
    const p = new OpenAIProvider();
    expect(await p.fim({ prefix: "soma(", suffix: ")", model: "gpt-4.1-mini" })).toBe(
      "a, b",
    );
  });
});
