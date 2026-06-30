import { describe, it, expect } from "vitest";
import { parseForm, buildFormTemplate } from "../src/gateway.js";

describe("formulário de perfil (/setup)", () => {
  it("o template lista os campos legíveis", () => {
    const t = buildFormTemplate();
    expect(t).toContain("Nome completo:");
    expect(t).toContain("Amazon senha:");
    expect(t).toContain("Cartão número:");
    expect(t).toContain("Gostos dessa pessoa:");
  });

  it("parseia o formulário devolvido nos campos do cofre", () => {
    const filled = [
      "Nome completo: Israel Augusto",
      "CPF: 074.456.671-13",
      "Amazon login: a@b.com",
      "Amazon senha: segredo123",
      "linha aleatória sem dois-pontos",
      "Time do coração: Palmeiras",
    ].join("\n");
    const p = parseForm(filled);
    expect(p.name).toBe("Israel Augusto");
    expect(p.cpf).toBe("074.456.671-13");
    expect(p.amazon_login).toBe("a@b.com");
    expect(p.amazon_password).toBe("segredo123");
    expect(p.team).toBe("Palmeiras");
    expect(Object.keys(p)).toHaveLength(5);
  });

  it("ignora campos vazios e 'pular' (não sobrescreve com nada)", () => {
    const p = parseForm("Nome completo: \nCPF: pular\nCidade: Sarandi");
    expect(p.name).toBeUndefined();
    expect(p.cpf).toBeUndefined();
    expect(p.city).toBe("Sarandi");
  });

  it("casa rótulo mesmo com acento/caixa diferente", () => {
    const p = parseForm("gênero: masculino\nNÚMERO DO CALÇADO: 38");
    expect(p.gender).toBe("masculino");
    expect(p.shoe_size).toBe("38");
  });
});
