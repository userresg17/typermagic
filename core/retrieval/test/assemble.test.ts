import { describe, it, expect } from "vitest";
import { assembleContext, renderContext } from "../src/assemble.js";
import type { ContextFile, Snippet } from "../src/types.js";

const file = (path: string, content: string): ContextFile => ({
  path,
  content,
  truncated: false,
});
const snip = (file: string, line: number, text: string): Snippet => ({
  file,
  line,
  text,
});

describe("assembleContext", () => {
  it("mantém arquivo e trechos quando cabem no orçamento", () => {
    const ctx = assembleContext(
      "q",
      [file("a.ts", "const x = 1;")],
      [snip("b.ts", 3, "const y = 2;")],
      { maxTokens: 1000 },
    );
    expect(ctx.files).toHaveLength(1);
    expect(ctx.snippets).toHaveLength(1);
    expect(ctx.approxTokens).toBeGreaterThan(0);
  });

  it("trunca o primeiro arquivo quando ele já estoura o orçamento", () => {
    const big = "x".repeat(4000); // ~1000 tokens
    const ctx = assembleContext("q", [file("a.ts", big)], [], {
      maxTokens: 50,
    });
    expect(ctx.files).toHaveLength(1);
    expect(ctx.files[0]!.truncated).toBe(true);
    expect(ctx.files[0]!.content.length).toBeLessThan(big.length);
    expect(ctx.approxTokens).toBeLessThanOrEqual(50);
  });

  it("corta trechos que não cabem", () => {
    const snippets = Array.from({ length: 50 }, (_, i) =>
      snip("f.ts", i, "x".repeat(100)),
    );
    const ctx = assembleContext("q", [], snippets, { maxTokens: 100 });
    expect(ctx.snippets.length).toBeLessThan(50);
    expect(ctx.approxTokens).toBeLessThanOrEqual(100);
  });
});

describe("renderContext", () => {
  it("renderiza arquivo em bloco de código e trechos em lista", () => {
    const ctx = assembleContext(
      "q",
      [file("src/a.ts", "const x = 1;")],
      [snip("src/b.ts", 7, "foo()")],
      { maxTokens: 1000 },
    );
    const out = renderContext(ctx);
    expect(out).toContain("## Arquivo: src/a.ts");
    expect(out).toContain("```ts");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("src/b.ts:7: foo()");
  });

  it("marca arquivo truncado", () => {
    const ctx = assembleContext("q", [file("a.ts", "x".repeat(4000))], [], {
      maxTokens: 50,
    });
    expect(renderContext(ctx)).toContain("(truncado)");
  });
});
