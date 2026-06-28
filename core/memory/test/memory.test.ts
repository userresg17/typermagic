import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEmbedder } from "@typer/index";
import { MarkdownMemory } from "../src/store.js";
import { scoreMemory, recencyScore } from "../src/recall.js";

describe("recall scoring", () => {
  it("recência decai por meia-vida", () => {
    const now = 1_000 * 3_600_000; // 1000h em ms
    expect(recencyScore(now, now, 24)).toBeCloseTo(1, 6);
    expect(recencyScore(now - 24 * 3_600_000, now, 24)).toBeCloseTo(0.5, 6);
  });
  it("confiança modula o total (verificado pesa mais)", () => {
    const parts = { recency: 1, importance: 1, relevance: 1 };
    const alta = scoreMemory({ ...parts, confidence: 1 });
    const baixa = scoreMemory({ ...parts, confidence: 0 });
    expect(alta).toBeGreaterThan(baixa);
  });
});

describe("MarkdownMemory", () => {
  let dir: string;
  let mem: MarkdownMemory;
  const now = Date.parse("2026-06-26T12:00:00Z");

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "typer-mem-"));
    mem = new MarkdownMemory({
      dir,
      embedder: new FakeEmbedder(),
      clock: () => now,
    });
  });

  it("escreve episódio e fato e recupera por relevância", async () => {
    await mem.writeEpisode({ text: "decidimos usar fetch nativo, sem SDK" });
    await mem.writeSemantic({ text: "o projeto responde sempre em pt-BR" });
    await mem.writeEpisode({ text: "o parser de SSE trata content_block_delta" });

    const hits = await mem.recall("qual a decisão sobre SDK e fetch", 2);
    expect(hits.length).toBe(2);
    expect(hits[0]!.text).toContain("fetch nativo");
  });

  it("deduplica entradas quase idênticas", async () => {
    const a = await mem.writeEpisode({ text: "usar fetch nativo no core" });
    const b = await mem.writeEpisode({ text: "usar fetch nativo no core" });
    expect(a).not.toBeNull();
    expect(b).toBeNull(); // duplicata descartada
    expect(mem.size()).toBe(1);
  });

  it("persiste em markdown e relê no load", async () => {
    await mem.writeSemantic({
      text: "BYOK, sem servidor intermediário",
      importance: 0.9,
      verified: true,
      source: "adr",
    });

    const reloaded = new MarkdownMemory({
      dir,
      embedder: new FakeEmbedder(),
      clock: () => now,
    });
    await reloaded.load();
    expect(reloaded.size()).toBe(1);
    const hits = await reloaded.recall("BYOK servidor", 1);
    expect(hits[0]!.text).toContain("BYOK");
    expect(hits[0]!.verified).toBe(true);
    expect(hits[0]!.confidence).toBe(1);
  });

  it("a recência favorece o mais recente entre relevâncias iguais", async () => {
    await mem.writeEpisode({
      text: "nota sobre cache",
      at: "2026-06-01T12:00:00Z", // antigo
    });
    await mem.writeEpisode({
      text: "nota sobre cache",
      at: "2026-06-26T11:00:00Z", // recente (mesma relevância, texto igual seria dedup)
    });
    // textos iguais seriam deduplicados; uso textos próximos mas distintos:
    const fresh = new MarkdownMemory({
      dir: await mkdtemp(join(tmpdir(), "typer-mem2-")),
      embedder: new FakeEmbedder(),
      clock: () => now,
    });
    await fresh.writeEpisode({ text: "cache antigo de prompt", at: "2026-05-01T12:00:00Z" });
    await fresh.writeEpisode({ text: "cache recente de prompt agora", at: "2026-06-26T11:30:00Z" });
    const hits = await fresh.recall("cache de prompt", 2);
    expect(hits[0]!.at).toBe("2026-06-26T11:30:00Z");
  });
});
