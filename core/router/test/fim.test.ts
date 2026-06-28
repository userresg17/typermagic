import { describe, it, expect } from "vitest";
import {
  buildFimMessages,
  cleanFimCompletion,
  pickFimModel,
} from "../src/fim.js";

describe("buildFimMessages", () => {
  it("monta prefixo, cursor e sufixo numa mensagem", () => {
    const { system, messages } = buildFimMessages("function soma(", ") {}");
    expect(system).toMatch(/SOMENTE/);
    expect(messages).toHaveLength(1);
    const c = messages[0]!.content;
    expect(c).toContain("function soma(");
    expect(c).toContain(") {}");
    expect(c).toContain("<CURSOR>");
  });

  it("injeta o contexto ANTES da janela do cursor", () => {
    const ctx = "// símbolos em escopo: somaTudo(n: number[])";
    const { messages } = buildFimMessages("soma(", ")", ctx);
    const c = messages[0]!.content;
    expect(c).toContain(ctx);
    // contexto vem antes do <PREFIXO>
    expect(c.indexOf(ctx)).toBeLessThan(c.indexOf("<PREFIXO>"));
  });

  it("sem contexto, não muda o formato base", () => {
    const c = buildFimMessages("a", "b").messages[0]!.content;
    expect(c.startsWith("<PREFIXO>")).toBe(true);
  });
});

describe("cleanFimCompletion", () => {
  it("tira cercas de código", () => {
    expect(cleanFimCompletion("```ts\na, b\n```", "")).toBe("a, b");
  });

  it("remove repetição do prefixo no início", () => {
    expect(cleanFimCompletion("soma(a, b", "function ")).toBe("soma(a, b");
    expect(cleanFimCompletion("ction soma", "fun")).toBe("ction soma");
  });

  it("deixa a conclusão limpa intacta", () => {
    expect(cleanFimCompletion("a: number, b: number", "soma(")).toBe(
      "a: number, b: number",
    );
  });
});

describe("pickFimModel", () => {
  it("usa o modelo rápido da política", () => {
    expect(pickFimModel()).toBe("claude-haiku-4-5");
  });

  it("respeita o override", () => {
    expect(pickFimModel("codestral")).toBe("codestral");
  });
});
