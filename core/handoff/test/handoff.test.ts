import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEmbedder } from "@typer/index";
import { MarkdownMemory } from "@typer/memory";
import {
  validateHandoff,
  tokensOf,
  languageCanary,
  detectLocale,
  forcePrioritizeTier0,
  promoteRule,
  prunePointers,
  fillHandoff,
  persistHandoff,
  rePrimeText,
  migrateHandoff,
  RETENTION_POLICY,
  type Handoff,
  type Invariants,
} from "../src/index.js";

const baseInv = (over: Partial<Invariants> = {}): Invariants => ({
  locale: "pt-BR",
  hardConstraints: [],
  namingConvention: [],
  forbiddenErrors: [],
  activeGoal: "implementar o handoff",
  sectionOverlay: [],
  pinned: [],
  ...over,
});

const baseHandoff = (over: Partial<Handoff> = {}): Handoff => ({
  schema: 1,
  section: "core/handoff",
  createdAt: "2026-06-26T12:00:00Z",
  tier0: baseInv(),
  tier1: { entries: [] },
  tier2: { done: [], inProgress: [], focus: "schema" },
  tier3: { pointers: [] },
  ...over,
});

describe("validateHandoff", () => {
  it("aceita um handoff válido", () => {
    expect(validateHandoff(baseHandoff()).ok).toBe(true);
  });
  it("exige locale e activeGoal", () => {
    const r = validateHandoff(baseHandoff({ tier0: baseInv({ locale: "", activeGoal: "" }) }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/locale/);
    expect(r.errors.join(" ")).toMatch(/activeGoal/);
  });
  it("reprova Tier 0 acima do teto", () => {
    const huge = Array.from({ length: 2000 }, (_, i) => `restrição número ${i}`);
    const r = validateHandoff(baseHandoff({ tier0: baseInv({ hardConstraints: huge }) }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/teto/);
  });
});

describe("canário de idioma", () => {
  it("detecta pt-BR e en", () => {
    expect(detectLocale("isso não está certo, você precisa corrigir a função")).toBe("pt-BR");
    expect(detectLocale("this is the function you should fix now")).toBe("en");
  });
  it("dispara (false) quando a resposta foge do locale do Tier 0", () => {
    const h = baseHandoff(); // locale pt-BR
    expect(languageCanary("vou corrigir a função agora, sem problema", h)).toBe(true);
    expect(languageCanary("I will fix this function right now for you", h)).toBe(false);
  });
});

describe("retenção", () => {
  it("force-prioritize traz o Tier 0 para baixo do teto, mantendo obrigatórios", () => {
    const huge = Array.from({ length: 2000 }, (_, i) => `convenção ${i}`);
    const inv = baseInv({ namingConvention: huge, hardConstraints: ["BYOK"] });
    const out = forcePrioritizeTier0(inv);
    expect(tokensOf(out)).toBeLessThanOrEqual(RETENTION_POLICY[0].maxTokens);
    expect(out.locale).toBe("pt-BR");
    expect(out.activeGoal).toBe("implementar o handoff");
  });

  it("promoteRule fixa uma regra e deduplica", () => {
    let inv = baseInv();
    inv = promoteRule(inv, "responder em pt-BR", "user", "2026-06-26T12:00:00Z");
    inv = promoteRule(inv, "responder em pt-BR", "user", "2026-06-26T12:01:00Z");
    expect(inv.pinned).toHaveLength(1);
  });

  it("prunePointers mantém os de maior score sob o teto", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      kind: "file" as const,
      ref: `src/f${i}.ts#L1-L40`,
      score: i / 500,
    }));
    const kept = prunePointers(many);
    expect(kept.length).toBeLessThan(many.length);
    // o de maior score (último) sobrevive
    expect(kept.some((p) => p.ref === "src/f499.ts#L1-L40")).toBe(true);
  });

  it("fillHandoff copia Tier 0, anexa Tier 1, regenera Tier 2", () => {
    const prev = baseHandoff({
      tier1: { entries: [{ decision: "usar fetch", rationale: "sem SDK", at: "t0" }] },
    });
    const h = fillHandoff(prev, {
      section: "core/handoff",
      createdAt: "2026-06-26T13:00:00Z",
      tier0: baseInv({ sectionOverlay: ["seguir o schema à risca"] }),
      newDecisions: [{ decision: "tier0 verbatim", rationale: "anti-drift", at: "t1" }],
      workState: { done: ["schema"], inProgress: ["persist"], focus: "persist" },
    });
    expect(h.tier1.entries).toHaveLength(2); // append-only
    expect(h.tier2.focus).toBe("persist"); // regerado
    expect(h.tier0.sectionOverlay).toContain("seguir o schema à risca");
  });
});

describe("persistência e re-priming", () => {
  it("persiste decisões e estado na memória, e recupera", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typer-handoff-"));
    const mem = new MarkdownMemory({ dir, embedder: new FakeEmbedder() });
    const h = baseHandoff({
      tier1: { entries: [{ decision: "usar fetch nativo", rationale: "core sem SDK", at: "2026-06-26T12:00:00Z" }] },
      tier2: { done: ["schema"], inProgress: ["persist"], focus: "salvar na memória" },
    });
    const n = await persistHandoff(h, mem);
    expect(n).toBe(2); // 1 decisão + 1 estado
    const hits = await mem.recall("decisão sobre fetch e SDK", 1);
    expect(hits[0]!.text).toMatch(/fetch nativo/);
  });

  it("rePrimeText inclui locale e objetivo (a âncora)", () => {
    const text = rePrimeText(baseHandoff());
    expect(text).toContain("Idioma: pt-BR");
    expect(text).toContain("implementar o handoff");
  });
});

describe("migração", () => {
  it("normaliza para a versão atual e barra versão futura", () => {
    expect(migrateHandoff({ schema: 1 } as Handoff).schema).toBe(1);
    expect(() => migrateHandoff({ schema: 99 } as Handoff)).toThrow(/mais novo/);
  });
});
