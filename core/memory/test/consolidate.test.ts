import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEmbedder } from "@typer/index";
import { MarkdownMemory } from "../src/store.js";

let dir: string;
let mem: MarkdownMemory;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "typer-consol-"));
  mem = new MarkdownMemory({ dir, embedder: new FakeEmbedder() });
});

// sumarizador determinístico de teste (em produção é uma chamada de LLM)
const stubSummarize = async (texts: string[]): Promise<string> =>
  `fato consolidado sobre fetch nativo (de ${texts.length} episódios)`;

describe("MarkdownMemory.consolidate", () => {
  it("destila um fato semântico de um cluster de episódios parecidos", async () => {
    await mem.writeEpisode({ text: "decidimos usar fetch nativo sem SDK no core" });
    await mem.writeEpisode({ text: "fetch nativo no core, sem SDK, é a escolha" });
    await mem.writeEpisode({ text: "core usa fetch nativo e evita SDK de provider" });
    // um episódio distinto, que não deve formar fato sozinho
    await mem.writeEpisode({ text: "formatar datas com Intl DateTimeFormat" });

    const created = await mem.consolidate({
      summarize: stubSummarize,
      minSupport: 2,
      simThreshold: 0.4,
    });

    expect(created.length).toBe(1);
    expect(created[0]!.kind).toBe("semantic");
    expect(created[0]!.source).toBe("consolidation");
    expect(created[0]!.confidence).toBeGreaterThan(0.5);

    // o fato consolidado fica na biblioteca e é recuperável
    const hits = await mem.recall("fato consolidado sobre fetch nativo", 5);
    expect(hits.some((h) => h.source === "consolidation")).toBe(true);
  });

  it("não destila nada quando não há suporte mínimo", async () => {
    await mem.writeEpisode({ text: "um evento isolado qualquer aqui" });
    const created = await mem.consolidate({
      summarize: stubSummarize,
      minSupport: 2,
    });
    expect(created).toEqual([]);
  });
});
