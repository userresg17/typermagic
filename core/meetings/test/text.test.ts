import { describe, it, expect } from "vitest";
import { normalize, slugify, tokenize, isMeetingForward, titleFromText, chunkText, shortHash, datePrefix } from "../src/text.js";

describe("text — normalização e slug", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(normalize("Reunião: Planejamento Q4!")).toBe("reuniao planejamento q4");
    expect(slugify("Reunião de Vendas — Outubro/2026")).toBe("reuniao-de-vendas-outubro-2026");
    expect(slugify("")).toBe("reuniao");
  });
  it("tokeniza sem stopwords", () => {
    expect(tokenize("o que combinamos com o time de dev")).toEqual(["combinamos", "time", "dev"]);
  });
  it("hash curto é estável", () => {
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
  });
  it("prefixo de data é local", () => {
    expect(datePrefix(new Date(2026, 9, 11, 14, 5))).toBe("2026-10-11_1405");
  });
});

describe("isMeetingForward — o que entra na central vindo do Telegram", () => {
  const longo = "Reunião com os sócios\n" + "Falamos do caixa, do novo escritório e da contratação.\n".repeat(6);
  it("resumo longo com 'reunião' entra", () => {
    expect(isMeetingForward(longo)).toBe(true);
  });
  it("aceita sem acento e em caixa alta", () => {
    expect(isMeetingForward("REUNIAO de vendas\n" + "linha\n".repeat(5))).toBe(true);
  });
  it("prefixo explícito 'reunião:' entra mesmo curto", () => {
    expect(isMeetingForward("reunião: decidimos adiar o lançamento para novembro")).toBe(true);
  });
  it("pergunta curta sobre reunião NÃO entra (vai pro agente)", () => {
    expect(isMeetingForward("o que ficou decidido na reunião de ontem?")).toBe(false);
    expect(isMeetingForward("junta o que combinamos com o dev e o que os sócios falaram num resumo só para eu levar na reunião de vendas")).toBe(false);
  });
  it("sem a palavra não entra; comando não entra", () => {
    expect(isMeetingForward("Falamos do caixa.\n".repeat(10))).toBe(false);
    expect(isMeetingForward("/reunioes")).toBe(false);
  });
  it("documento anexado com a palavra entra", () => {
    expect(isMeetingForward("reunião de hoje", { hasDocument: true })).toBe(true);
  });
  it("'reunir' não conta como reunião", () => {
    expect(isMeetingForward("vamos nos reunir amanhã\n".repeat(5))).toBe(false);
  });
});

describe("titleFromText / chunkText", () => {
  it("1ª linha curta vira título, sem o prefixo", () => {
    expect(titleFromText("Reunião: Kickoff do app\nblá")).toBe("Kickoff do app");
    expect(titleFromText("reunião\nblá")).toBeNull();
    expect(titleFromText("x".repeat(120) + "\nblá")).toBeNull();
  });
  it("fatia em parágrafos sem perder texto", () => {
    const paras = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} ` + "palavra ".repeat(40)).join("\n\n");
    const chunks = chunkText(paras, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join("\n\n").replace(/\s+/g, " ").trim()).toBe(paras.replace(/\s+/g, " ").trim());
  });
});
