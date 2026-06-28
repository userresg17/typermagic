import { describe, it, expect } from "vitest";
import { extractSymbols } from "../src/symbols.js";
import { SymbolGraph } from "../src/symbol-graph.js";

describe("extractSymbols", () => {
  it("acha definições e referências em TypeScript", async () => {
    const code = `
export function soma(a: number, b: number) { return a + b; }
export class Calc {
  total(xs: number[]) { return xs.reduce(soma, 0); }
}
`;
    const sym = await extractSymbols(code, "calc.ts");
    expect(sym).not.toBeNull();
    const names = sym!.defs.map((d) => d.name);
    expect(names).toContain("soma");
    expect(names).toContain("Calc");
    // referencia "reduce" e "soma" (soma é def, excluída dos refs)
    expect(sym!.refs).toContain("reduce");
  });

  it("retorna null sem gramática", async () => {
    expect(await extractSymbols("x", "a.txt")).toBeNull();
  });
});

describe("SymbolGraph", () => {
  it("cria aresta quando um arquivo referencia símbolo definido em outro", async () => {
    const g = new SymbolGraph();
    // a.ts define soma; b.ts referencia soma
    g.addFile("a.ts", { defs: [{ name: "soma", file: "a.ts", line: 1, kind: "function_declaration" }], refs: [] });
    g.addFile("b.ts", { defs: [], refs: ["soma"] });

    expect(g.definitionsOf("soma")).toEqual(["a.ts"]);
    expect([...g.neighbors("b.ts")]).toEqual(["a.ts"]);
    const rel = g.related("b.ts");
    expect(rel[0]!.file).toBe("a.ts");
  });

  it("ranqueia por proximidade BFS (vizinho direto > indireto)", () => {
    const g = new SymbolGraph();
    // a usa b; b usa c  => de a: b(dist1) acima de c(dist2)
    g.addFile("a.ts", { defs: [], refs: ["fnB"] });
    g.addFile("b.ts", { defs: [{ name: "fnB", file: "b.ts", line: 1, kind: "function_declaration" }], refs: ["fnC"] });
    g.addFile("c.ts", { defs: [{ name: "fnC", file: "c.ts", line: 1, kind: "function_declaration" }], refs: [] });

    const rel = g.related("a.ts", 5, 2);
    const byFile = Object.fromEntries(rel.map((r) => [r.file, r.score]));
    expect(byFile["b.ts"]).toBeGreaterThan(byFile["c.ts"]!);
  });

  it("removeFile tira as definições do grafo (incremental)", () => {
    const g = new SymbolGraph();
    g.addFile("a.ts", { defs: [{ name: "soma", file: "a.ts", line: 1, kind: "x" }], refs: [] });
    g.addFile("b.ts", { defs: [], refs: ["soma"] });
    expect(g.neighbors("b.ts").size).toBe(1);
    g.removeFile("a.ts");
    expect(g.definitionsOf("soma")).toEqual([]);
    expect(g.neighbors("b.ts").size).toBe(0);
    expect(g.size()).toBe(1); // b.ts ainda está
  });
});
