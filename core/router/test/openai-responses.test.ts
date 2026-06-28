import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toResponsesInput,
  toResponsesTools,
  chatViaChatGptBackend,
} from "../src/openai-responses.js";
import type { Auth } from "../src/auth.js";

const OAUTH: Extract<Auth, { kind: "oauth" }> = {
  kind: "oauth",
  token: "AT",
  provider: "openai",
  accountId: "acc-123",
};

function sseStream(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n`));
      controller.close();
    },
  });
}

describe("toResponsesInput", () => {
  it("system vira instructions; user/assistant viram message items", () => {
    const { instructions, input } = toResponsesInput("seja breve", [
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá" },
    ]);
    expect(instructions).toBe("seja breve");
    expect(input[0]).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "oi" }] });
    expect(input[1]).toEqual({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "olá" }],
    });
  });

  it("tool-call do assistant e resultado de tool viram function_call / function_call_output", () => {
    const { input } = toResponsesInput(undefined, [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "ls", arguments: { path: "." } }] },
      { role: "tool", toolCallId: "c1", content: "a.ts" },
    ]);
    expect(input[0]).toEqual({ type: "function_call", call_id: "c1", name: "ls", arguments: '{"path":"."}' });
    expect(input[1]).toEqual({ type: "function_call_output", call_id: "c1", output: "a.ts" });
  });
});

describe("toResponsesTools", () => {
  it("formato function achatado (sem wrapper)", () => {
    const t = toResponsesTools([{ name: "ls", description: "lista", inputSchema: { type: "object" } }]);
    expect(t).toEqual([{ type: "function", name: "ls", description: "lista", parameters: { type: "object" }, strict: false }]);
  });
});

describe("chatViaChatGptBackend", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("manda Bearer + ChatGPT-Account-ID + originator e fala no endpoint do backend", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      return { ok: true, body: sseStream([{ type: "response.output_text.delta", delta: "x" }]) };
    });
    vi.stubGlobal("fetch", fetchMock);
    for await (const _ of chatViaChatGptBackend({ messages: [{ role: "user", content: "oi" }], model: "gpt-5" }, OAUTH)) void _;
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string>; body: string };
    expect(init.headers["authorization"]).toBe("Bearer AT");
    expect(init.headers["ChatGPT-Account-ID"]).toBe("acc-123");
    expect(init.headers["originator"]).toBe("codex_cli_rs");
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.input[0]).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "oi" }] });
  });

  it("parseia deltas de texto, tool-calls e usage do response.completed", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      body: sseStream([
        { type: "response.output_text.delta", delta: "Olá " },
        { type: "response.output_text.delta", delta: "mundo" },
        { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "ls", arguments: '{"path":"."}' } },
        { type: "response.completed", response: { usage: { input_tokens: 11, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } } },
      ]),
    }));
    let text = "";
    let usage: unknown;
    let toolCalls: unknown;
    for await (const c of chatViaChatGptBackend({ messages: [{ role: "user", content: "oi" }], model: "gpt-5" }, OAUTH)) {
      text += c.text;
      if (c.usage) usage = c.usage;
      if (c.toolCalls) toolCalls = c.toolCalls;
    }
    expect(text).toBe("Olá mundo");
    expect(usage).toEqual({ inputTokens: 11, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 0 });
    expect(toolCalls).toEqual([{ id: "c1", name: "ls", arguments: { path: "." } }]);
  });

  it("erro HTTP do backend vira exceção clara", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403, text: async () => "blocked" }));
    const gen = chatViaChatGptBackend({ messages: [{ role: "user", content: "oi" }], model: "gpt-5" }, OAUTH);
    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow(/backend respondeu 403/);
  });

  it("ignora o modelo do roteador e faz fallback no 400 de 'model not supported'", async () => {
    delete process.env.TYPER_OPENAI_CHATGPT_MODEL;
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      call++;
      const model = JSON.parse(init.body).model;
      if (call === 1) {
        expect(model).toBe("gpt-5-codex"); // 1º candidato Codex (não o gpt-4.1 do roteador)
        return { ok: false, status: 400, text: async () => '{"detail":"The model is not supported"}' };
      }
      expect(model).toBe("gpt-5"); // fallback automático
      return { ok: true, body: sseStream([{ type: "response.output_text.delta", delta: "ok" }]) };
    });
    vi.stubGlobal("fetch", fetchMock);
    let text = "";
    for await (const c of chatViaChatGptBackend({ messages: [{ role: "user", content: "oi" }], model: "gpt-4.1" }, OAUTH)) text += c.text;
    expect(text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
