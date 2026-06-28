import { describe, it, expect } from "vitest";
import { renderDiff, renderPlanDiff } from "../src/diff.js";
import type { FilePlan } from "../src/types.js";

describe("renderDiff", () => {
  it("mostra linha removida e adicionada com contexto", () => {
    const before = "a\nb\nc\nd\n";
    const after = "a\nb\nC\nd\n";
    const out = renderDiff("f.ts", before, after);
    expect(out).toContain("--- a/f.ts");
    expect(out).toContain("+++ b/f.ts");
    expect(out).toContain("-c");
    expect(out).toContain("+C");
    expect(out).toContain(" b"); // contexto
  });

  it("vazio quando não há mudança", () => {
    expect(renderDiff("f.ts", "x\n", "x\n")).toBe("");
  });

  it("trata criação como tudo adicionado", () => {
    const out = renderDiff("novo.ts", "", "linha1\nlinha2");
    expect(out).toContain("+linha1");
    expect(out).toContain("+linha2");
  });
});

describe("renderPlanDiff", () => {
  it("marca erro de plano", () => {
    const plan: FilePlan = {
      file: "a.ts",
      before: "x",
      after: "x",
      status: "error",
      edits: 0,
      error: "Trecho não encontrado.",
    };
    expect(renderPlanDiff(plan)).toContain("✗ a.ts");
  });

  it("rotula novo arquivo", () => {
    const plan: FilePlan = {
      file: "n.ts",
      before: "",
      after: "z\n",
      status: "create",
      edits: 1,
    };
    expect(renderPlanDiff(plan)).toContain("novo arquivo");
  });
});
