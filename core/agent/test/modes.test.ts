// Testes da subfase 5.2 — modos do agente.
import { describe, it, expect } from "vitest";
import {
  MODES,
  MODE_NAMES,
  DEFAULT_MODE,
  isModeName,
  resolveMode,
} from "../src/modes.js";

describe("modos do agente (5.2)", () => {
  it("tem os 5 modos: code, debug, architect, ask, gather", () => {
    expect(MODE_NAMES.sort()).toEqual(
      ["architect", "ask", "code", "debug", "gather"].sort(),
    );
  });

  it("só Code e Debug editam; Architect/Ask/Gather são somente-leitura", () => {
    expect(MODES.code.allowsEdit).toBe(true);
    expect(MODES.debug.allowsEdit).toBe(true);
    expect(MODES.architect.allowsEdit).toBe(false);
    expect(MODES.ask.allowsEdit).toBe(false);
    expect(MODES.gather.allowsEdit).toBe(false);
  });

  it("modos que editam usam a tarefa 'agent'; somente-leitura usam 'chat'", () => {
    for (const m of MODE_NAMES) {
      expect(MODES[m].task).toBe(MODES[m].allowsEdit ? "agent" : "chat");
    }
  });

  it("Code e Debug carregam o formato de edição (SEARCH/REPLACE)", () => {
    expect(MODES.code.system).toContain("SEARCH");
    expect(MODES.code.system).toContain("REPLACE");
    expect(MODES.debug.system).toContain("SEARCH");
    // Debug acrescenta o enquadramento de causa-raiz antes do formato
    expect(MODES.debug.system).toMatch(/causa-raiz/i);
  });

  it("modos somente-leitura proíbem edição na instrução e não pedem blocos", () => {
    for (const m of ["architect", "ask", "gather"] as const) {
      expect(MODES[m].system).not.toContain("<<<<<<< SEARCH");
      // proíbe editar: "NÃO edite", "não proponha", "NUNCA proponha"…
      expect(MODES[m].system).toMatch(/(não|nunca)[\s\S]{0,20}(edit|prop)/i);
    }
  });

  it("resolveMode: default é code, resolve por nome (case-insensitive)", () => {
    expect(resolveMode().name).toBe(DEFAULT_MODE);
    expect(resolveMode(null).name).toBe("code");
    expect(resolveMode("").name).toBe("code");
    expect(resolveMode("ARCHITECT").name).toBe("architect");
    expect(resolveMode("Gather").name).toBe("gather");
  });

  it("resolveMode lança em modo desconhecido, listando as opções", () => {
    expect(() => resolveMode("xpto")).toThrowError(/desconhecido/i);
    expect(() => resolveMode("xpto")).toThrowError(/code/);
  });

  it("isModeName reconhece válidos e rejeita inválidos", () => {
    expect(isModeName("code")).toBe(true);
    expect(isModeName("gather")).toBe(true);
    expect(isModeName("nope")).toBe(false);
  });
});
