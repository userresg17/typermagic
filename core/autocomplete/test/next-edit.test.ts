import { describe, it, expect } from "vitest";
import { parseNextEdit, buildNextEditPrompt, predictNextEdit } from "../src/index.js";
import { FakeProvider } from "@typer/router";

describe("parseNextEdit", () => {
  it("extrai JSON puro", () => {
    const e = parseNextEdit(
      '{"range":{"startLine":3,"startCol":0,"endLine":3,"endCol":5},"text":"foo()","confidence":0.8}',
    );
    expect(e).toEqual({
      range: { startLine: 3, startCol: 0, endLine: 3, endCol: 5 },
      text: "foo()",
      confidence: 0.8,
    });
  });

  it("extrai JSON cercado por prosa", () => {
    const e = parseNextEdit('Acho que: {"range":{"startLine":1,"startCol":2,"endLine":1,"endCol":2},"text":"x","confidence":0.5} pronto');
    expect(e?.text).toBe("x");
  });

  it("clampa confidence e piso de coords negativas", () => {
    const e = parseNextEdit('{"range":{"startLine":-1,"startCol":0,"endLine":0,"endCol":0},"text":"y","confidence":9}');
    expect(e?.confidence).toBe(1);
    expect(e?.range.startLine).toBe(0);
  });

  it("null em texto sem JSON válido", () => {
    expect(parseNextEdit("sem json aqui")).toBeNull();
    expect(parseNextEdit('{"text":"falta range"}')).toBeNull();
  });
});

describe("buildNextEditPrompt", () => {
  it("inclui rastro, código e linha do cursor", () => {
    const p = buildNextEditPrompt({
      file: "a.ts",
      recentEdits: [{ file: "a.ts", before: "", after: "const x" }],
      code: "const x = 1;",
      cursorLine: 0,
    });
    expect(p).toContain("const x");
    expect(p).toContain("linha 0");
    expect(p).toContain("const x = 1;");
  });
});

describe("predictNextEdit (FakeProvider)", () => {
  it("retorna null quando o modelo não devolve JSON válido", async () => {
    const edit = await predictNextEdit(new FakeProvider(), "fake", {
      file: "a.ts",
      recentEdits: [],
      code: "x",
      cursorLine: 0,
    });
    expect(edit).toBeNull(); // Fake ecoa o prompt, sem JSON → null
  });
});
