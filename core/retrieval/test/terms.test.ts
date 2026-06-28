import { describe, it, expect } from "vitest";
import { extractTerms } from "../src/terms.js";

describe("extractTerms", () => {
  it("tira stopwords e tokens curtos", () => {
    const t = extractTerms("o que faz a função pickModel no router");
    expect(t).toContain("pickModel");
    expect(t).toContain("router");
    expect(t).not.toContain("que");
    expect(t).not.toContain("no");
  });

  it("preserva identificadores camelCase inteiros", () => {
    expect(extractTerms("explique AnthropicProvider")).toContain(
      "AnthropicProvider",
    );
  });

  it("deduplica e limita a 6 termos", () => {
    const t = extractTerms(
      "alpha beta gamma delta epsilon zeta eta theta alpha beta",
    );
    expect(t.length).toBe(6);
    expect(new Set(t).size).toBe(6);
  });

  it("retorna vazio para consulta só de stopwords", () => {
    expect(extractTerms("o que é o que")).toEqual([]);
  });
});
