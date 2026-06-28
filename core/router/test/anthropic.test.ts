import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AnthropicProvider } from "../src/anthropic.js";

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

const KEY = "TYPER_ANTHROPIC_KEY";
let original: string | undefined;

beforeEach(() => {
  original = process.env[KEY];
  process.env[KEY] = "sk-teste";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("AnthropicProvider.chat — cache e uso real", () => {
  it("envia cache_control no system quando cache=true e captura o uso", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: sseStream([
        {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 1200,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 0,
            },
          },
        },
        { type: "content_block_delta", delta: { text: "oi" } },
        { type: "message_delta", usage: { output_tokens: 7 } },
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new AnthropicProvider();
    let text = "";
    let usage: unknown;
    for await (const c of p.chat({
      messages: [{ role: "user", content: "oi" }],
      model: "claude-opus-4-8",
      system: "instrução estável",
      cache: true,
    })) {
      text += c.text;
      if (c.usage) usage = c.usage;
    }

    expect(text).toBe("oi");
    expect(usage).toEqual({
      inputTokens: 1200,
      outputTokens: 7,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("manda system como string simples quando cache=false", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: sseStream([{ type: "content_block_delta", delta: { text: "x" } }]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new AnthropicProvider();
    for await (const _ of p.chat({
      messages: [{ role: "user", content: "oi" }],
      model: "claude-opus-4-8",
      system: "instrução",
    })) {
      void _;
    }
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.system).toBe("instrução");
  });
});
