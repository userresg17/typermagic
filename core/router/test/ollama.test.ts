import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaProvider, parseOllamaChatLine } from "../src/ollama.js";

describe("parseOllamaChatLine", () => {
  it("extrai o delta de content", () => {
    expect(parseOllamaChatLine('{"message":{"content":"olá"}}')).toBe("olá");
  });
  it("retorna null para linha vazia ou inválida", () => {
    expect(parseOllamaChatLine("")).toBeNull();
    expect(parseOllamaChatLine("não-json")).toBeNull();
    expect(parseOllamaChatLine('{"done":true}')).toBeNull();
  });
});

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l + "\n"));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("OllamaProvider", () => {
  it("faz streaming do chat via NDJSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: ndjsonStream([
          '{"message":{"content":"ola"}}',
          '{"message":{"content":" mundo"}}',
          '{"done":true}',
        ]),
      })),
    );
    const p = new OllamaProvider();
    let out = "";
    for await (const c of p.chat({
      messages: [{ role: "user", content: "oi" }],
      model: "llama3.2",
    })) {
      out += c.text;
    }
    expect(out).toBe("ola mundo");
  });

  it("usa FIM nativo via /api/generate com suffix", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: "a, b" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new OllamaProvider();
    const out = await p.fim({
      prefix: "soma(",
      suffix: ") {}",
      model: "qwen2.5-coder",
    });
    expect(out).toBe("a, b");
    // confirma que prefixo e sufixo foram enviados
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.prompt).toBe("soma(");
    expect(body.suffix).toBe(") {}");
    expect(body.model).toBe("qwen2.5-coder");
  });

  it("estoura com mensagem clara em erro HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const p = new OllamaProvider();
    expect(await p.fim({ prefix: "x", suffix: "", model: "m" })).toBe("");
  });
});
