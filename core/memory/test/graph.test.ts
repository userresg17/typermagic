import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEmbedder } from "@typer/index";
import { MarkdownMemory } from "../src/store.js";
import { parseWikilinks, parseTags, slugify, resolveLink } from "../src/links.js";
import { NoteGraph } from "../src/graph.js";
import type { MemoryEntry } from "../src/types.js";

describe("links — parsing", () => {
  it("extrai wikilinks com e sem alias", () => {
    const ls = parseWikilinks("veja [[router]] e [[Selo de verificação|o selo]] mais [[id-123]]");
    expect(ls.map((l) => l.target)).toEqual(["router", "Selo de verificação", "id-123"]);
    expect(ls[1]!.alias).toBe("o selo");
  });

  it("extrai tags, ignorando código e heading", () => {
    const tags = parseTags("# Título não é tag\nusa #router e #pt-br\n```\n#fff dentro de código\n```");
    expect(tags.sort()).toEqual(["pt-br", "router"]);
  });

  it("slugify normaliza caixa e acentos", () => {
    expect(slugify("Selo de Verificação")).toBe("selo-de-verificacao");
  });

  it("resolveLink: id → título → slug, senão dangling (null)", () => {
    const idx = new Map<string, string>([
      ["ep-1", "ep-1"],
      ["o selo", "ep-1"],
      ["o-selo", "ep-1"],
    ]);
    expect(resolveLink("ep-1", idx)).toBe("ep-1");
    expect(resolveLink("O Selo", idx)).toBe("ep-1");
    expect(resolveLink("inexistente", idx)).toBeNull();
  });
});

function entry(over: Partial<MemoryEntry> & { id: string; text: string }): MemoryEntry {
  return {
    kind: "semantic",
    at: "2026-06-26T12:00:00Z",
    importance: 0.5,
    confidence: 0.6,
    source: "agent",
    verified: false,
    ...over,
  };
}

describe("NoteGraph", () => {
  it("constrói arestas, backlinks e dangling", () => {
    const a = entry({ id: "a", title: "Alpha", text: "aponta para [[Beta]] e [[Fantasma]]" });
    const b = entry({ id: "b", title: "Beta", text: "nota beta sem links" });
    const g = NoteGraph.build([a, b]);
    expect(g.neighbors("a")).toContain("b");
    expect(g.backlinks("b")).toEqual(["a"]); // backlink derivado
    const view = g.toGraphView();
    expect(view.stats.notes).toBe(2);
    expect(view.stats.links).toBe(1); // só Beta resolveu; Fantasma é dangling
    expect(view.stats.dangling).toBe(1);
  });

  it("walk decai por profundidade e exclui a semente", () => {
    const a = entry({ id: "a", title: "A", text: "[[B]]" });
    const b = entry({ id: "b", title: "B", text: "[[C]]" });
    const c = entry({ id: "c", title: "C", text: "folha" });
    const g = NoteGraph.build([a, b, c]);
    const w = g.walk("a", 2);
    expect(w.has("a")).toBe(false); // semente excluída
    expect(w.get("b")).toBeCloseTo(0.5, 6); // d=1
    expect(w.get("c")).toBeCloseTo(0.25, 6); // d=2
  });

  it("agrupa por tag", () => {
    const a = entry({ id: "a", text: "sobre #router", tags: ["router"] });
    const b = entry({ id: "b", text: "também #router e #cache", tags: ["router", "cache"] });
    const g = NoteGraph.build([a, b]);
    expect(g.byTag("router").sort()).toEqual(["a", "b"]);
    expect(g.byTag("cache")).toEqual(["b"]);
  });
});

describe("MarkdownMemory — recall v2 com grafo", () => {
  let dir: string;
  const now = Date.parse("2026-06-26T12:00:00Z");

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "typer-memv2-"));
  });

  it("uma nota ligada a um hit sobe pelo grafo (spreading activation)", async () => {
    const mem = new MarkdownMemory({ dir, embedder: new FakeEmbedder(), clock: () => now });
    // 'router' casa a query; 'cost' não casa semanticamente, mas é linkada por 'router'
    await mem.writeSemantic({ text: "o router escolhe o modelo por tarefa", title: "router" });
    await mem.writeSemantic({ text: "detalhes de medição ligada ao [[router]]", title: "cost" });
    await mem.writeSemantic({ text: "assunto totalmente diferente sobre cores", title: "ui" });
    const hits = await mem.recall("router escolhe modelo", 3);
    const ids = hits.map((h) => h.title);
    // 'cost' (linkada a router) deve passar à frente de 'ui' (sem relação)
    expect(ids.indexOf("cost")).toBeLessThan(ids.indexOf("ui"));
  });

  it("expõe grafo, backlinks e tags pela store", async () => {
    const mem = new MarkdownMemory({ dir, embedder: new FakeEmbedder(), clock: () => now });
    await mem.writeSemantic({ text: "nota A aponta para [[B]] #infra", title: "A" });
    await mem.writeSemantic({ text: "nota B base", title: "B" });
    const view = mem.graphView();
    expect(view.nodes.length).toBe(2);
    expect(view.edges.length).toBe(1);
    const bId = mem.graphView().nodes.find((n) => n.title === "B")!.id;
    expect(mem.backlinks(bId).map((e) => e.title)).toEqual(["A"]);
    expect(mem.byTag("infra").map((e) => e.title)).toEqual(["A"]);
  });

  it("persiste title e tags no frontmatter e relê", async () => {
    const mem = new MarkdownMemory({ dir, embedder: new FakeEmbedder(), clock: () => now });
    await mem.writeSemantic({ text: "conteúdo", title: "Minha Nota", tags: ["alpha"] });
    const reloaded = new MarkdownMemory({ dir, embedder: new FakeEmbedder(), clock: () => now });
    await reloaded.load();
    const n = reloaded.graphView().nodes[0]!;
    expect(n.title).toBe("Minha Nota");
    expect(n.tags).toContain("alpha");
  });
});
