import { describe, it, expect } from "vitest";
import { chunkAst } from "../src/ast-chunk.js";
import { grammarNameFor } from "../src/languages.js";

const TS = `import { x } from "./x";

export function soma(a: number, b: number): number {
  return a + b;
}

export class Calculadora {
  private total = 0;
  add(n: number) {
    this.total += n;
    return this.total;
  }
}
`;

describe("grammarNameFor", () => {
  it("mapeia extensões para gramáticas", () => {
    expect(grammarNameFor("a.ts")).toBe("typescript");
    expect(grammarNameFor("a.tsx")).toBe("tsx");
    expect(grammarNameFor("a.py")).toBe("python");
    expect(grammarNameFor("a.txt")).toBeNull();
    expect(grammarNameFor("Makefile")).toBeNull();
  });
});

describe("chunkAst", () => {
  it("retorna null para arquivo sem gramática (cai no fallback)", async () => {
    expect(await chunkAst("qualquer coisa", "notas.txt")).toBeNull();
  });

  it("quebra TypeScript por símbolo de topo, sem cortar declaração", async () => {
    const chunks = await chunkAst(TS, "calc.ts", { maxLines: 6 });
    expect(chunks).not.toBeNull();
    const cs = chunks!;
    expect(cs.length).toBeGreaterThanOrEqual(2);
    // a função soma inteira cabe num chunk
    const soma = cs.find((c) => c.text.includes("function soma"))!;
    expect(soma.text).toContain("return a + b;");
    // a classe inteira (maior que o teto) vira um chunk só, não é fatiada
    const classe = cs.find((c) => c.text.includes("class Calculadora"))!;
    expect(classe.text).toContain("add(n: number)");
    expect(classe.text).toContain("this.total += n;");
  });

  it("quebra Python por def/class", async () => {
    const py = "def soma(a, b):\n    return a + b\n\nclass Foo:\n    def bar(self):\n        return 1\n";
    const chunks = await chunkAst(py, "m.py", { maxLines: 3 });
    expect(chunks).not.toBeNull();
    expect(chunks!.some((c) => c.text.includes("def soma"))).toBe(true);
  });
});
