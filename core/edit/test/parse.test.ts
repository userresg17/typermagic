import { describe, it, expect } from "vitest";
import { parseEdits, EditParseError } from "../src/parse.js";

const block = (file: string, search: string, replace: string) =>
  `### FILE: ${file}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

describe("parseEdits", () => {
  it("extrai um bloco simples", () => {
    const edits = parseEdits(block("a.ts", "const x = 1;", "const x = 2;"));
    expect(edits).toEqual([
      { file: "a.ts", search: "const x = 1;", replace: "const x = 2;" },
    ]);
  });

  it("extrai vários blocos e arquivos", () => {
    const text = [
      "blá blá fora do bloco",
      block("a.ts", "a", "A"),
      "mais texto solto",
      block("b.ts", "b", "B"),
    ].join("\n");
    const edits = parseEdits(text);
    expect(edits).toHaveLength(2);
    expect(edits[1]).toEqual({ file: "b.ts", search: "b", replace: "B" });
  });

  it("aceita SEARCH vazio para criação", () => {
    const edits = parseEdits(block("novo.ts", "", "conteúdo novo"));
    expect(edits[0]!.search).toBe("");
    expect(edits[0]!.replace).toBe("conteúdo novo");
  });

  it("tolera variação no número de sinais dos marcadores", () => {
    const text =
      "### FILE: a.ts\n<<<<<< SEARCH\nx\n========\ny\n>>>>>> REPLACE";
    const edits = parseEdits(text);
    expect(edits).toEqual([{ file: "a.ts", search: "x", replace: "y" }]);
  });

  it("erra quando um bloco não tem ### FILE: antes", () => {
    const text = "<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE";
    expect(() => parseEdits(text)).toThrow(EditParseError);
  });

  it("erra em bloco sem fechamento", () => {
    const text = "### FILE: a.ts\n<<<<<<< SEARCH\nx\n=======\ny";
    expect(() => parseEdits(text)).toThrow(/REPLACE/);
  });

  it("retorna vazio quando não há blocos (ex.: resposta offline)", () => {
    expect(parseEdits("eco: nada de blocos aqui")).toEqual([]);
  });
});
