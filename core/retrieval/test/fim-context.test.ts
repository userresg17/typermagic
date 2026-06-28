import { describe, it, expect } from "vitest";
import { assembleFimContext } from "../src/fim-context.js";

describe("assembleFimContext", () => {
  it("vazio quando não há sinais nem repo", () => {
    expect(assembleFimContext({ file: "a.ts" })).toBe("");
  });

  it("monta edit-trail, escopo, related, diagnósticos e tabs (comentados)", () => {
    const out = assembleFimContext(
      {
        file: "a.ts",
        editTrail: [{ file: "a.ts", before: "", after: "const x = 1" }],
        openTabs: ["a.ts", "b.ts"],
        diagnostics: [{ message: "x não usado", line: 3, severity: "aviso" }],
      },
      {
        scopeSymbols: [{ name: "soma", kind: "function" }],
        relatedDefs: [{ file: "util.ts", names: ["clamp", "lerp"] }],
      },
    );
    expect(out).toContain("Edições recentes");
    expect(out).toContain("+ const x = 1");
    expect(out).toContain("soma(function)");
    expect(out).toContain("util.ts: clamp, lerp");
    expect(out).toContain("x não usado");
    expect(out).toContain("b.ts"); // tab (a.ts é o arquivo atual, filtrado)
    expect(out).not.toMatch(/^.*Abas abertas:.*a\.ts/m);
    // tudo comentado (encaixa no FIM)
    for (const line of out.split("\n")) expect(line.startsWith("//")).toBe(true);
  });

  it("respeita o orçamento de caracteres (corta o menos prioritário)", () => {
    const big = "x".repeat(500);
    const out = assembleFimContext(
      {
        file: "a.ts",
        editTrail: [{ file: "a.ts", before: "", after: "edição importante" }],
        openTabs: [big],
      },
      { relatedDefs: [{ file: "z.ts", names: [big] }] },
      { maxChars: 80 },
    );
    expect(out.length).toBeLessThanOrEqual(81);
    // o edit-trail (prioridade máxima) sobrevive
    expect(out).toContain("edição importante");
  });
});
