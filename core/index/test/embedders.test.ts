import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { OllamaEmbedder, OpenAIEmbedder, FakeEmbedder } from "../src/embedders.js";

afterEach(() => vi.unstubAllGlobals());

describe("FakeEmbedder", () => {
  it("é determinístico e aproxima textos parecidos", async () => {
    const e = new FakeEmbedder();
    const [a] = await e.embed(["function soma a b"]);
    const [a2] = await e.embed(["function soma a b"]);
    expect(a).toEqual(a2);
  });
});

describe("OllamaEmbedder", () => {
  it("chama /api/embed e devolve os vetores", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embeddings: [[1, 2, 3]] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const e = new OllamaEmbedder("nomic-embed-text");
    expect(await e.embed(["oi"])).toEqual([[1, 2, 3]]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toEqual(["oi"]);
  });
});

describe("OpenAIEmbedder", () => {
  const KEY = "TYPER_OPENAI_KEY";
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[KEY];
    process.env[KEY] = "sk-teste";
  });
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("chama /v1/embeddings com Bearer e mapeia data[].embedding", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const e = new OpenAIEmbedder("text-embedding-3-small");
    expect(await e.embed(["oi"])).toEqual([[0.1, 0.2]]);
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).authorization).toMatch(
      /^Bearer /,
    );
  });
});
