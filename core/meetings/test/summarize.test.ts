import { describe, it, expect } from "vitest";
import { summarizeMeeting, extractJson, toSummary } from "../src/summarize.js";
import type { RawMeeting } from "../src/types.js";

const raw: RawMeeting = { sourceKey: "x", platform: "meet", date: "2026-10-11T10:00:00Z", text: "Alice: we ship on Friday. Bob: I'll write the docs." };

const JSON_OK = JSON.stringify({
  titulo: "Release planning",
  participantes: ["Alice", "Bob"],
  idioma: "en",
  resumo: "Alinharam a entrega de sexta.",
  decisoes: ["Entregar na sexta"],
  pendencias: [{ oQue: "Escrever a documentação", responsavel: "Bob", prazo: null }],
  proximosPassos: [],
});

describe("extractJson / toSummary", () => {
  it("tolera cerca de código e texto em volta", () => {
    expect(extractJson("claro!\n```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(() => extractJson("sem json")).toThrow();
  });
  it("preenche campos faltando e aceita pendência como string", () => {
    const s = toSummary({ pendencias: ["ligar pro cliente"], idioma: "PT-BR" }, "fallback");
    expect(s.titulo).toBe("fallback");
    expect(s.idioma).toBe("pt-br");
    expect(s.pendencias).toEqual([{ oQue: "ligar pro cliente", responsavel: "indefinido" }]);
    expect(s.decisoes).toEqual([]);
  });
});

describe("summarizeMeeting", () => {
  it("resume e traduz em blocos quando o idioma não é pt", async () => {
    const calls: string[] = [];
    const llm = async (system: string, user: string): Promise<string> => {
      calls.push(system.slice(0, 12));
      if (system.startsWith("Você é a secretária")) return JSON_OK;
      return `[pt] ${user}`;
    };
    const r = await summarizeMeeting(raw, llm, { chunkChars: 30 });
    expect(r.summary.titulo).toBe("Release planning");
    expect(r.summary.pendencias[0]).toEqual({ oQue: "Escrever a documentação", responsavel: "Bob" });
    expect(r.textPt).toContain("[pt] ");
    expect(r.calls).toBeGreaterThan(2); // 1 resumo + ≥2 blocos de tradução
  });
  it("não traduz quando já é pt, e junta participantes informados", async () => {
    const llm = async (): Promise<string> => JSON_OK.replace('"en"', '"pt"');
    const r = await summarizeMeeting({ ...raw, participants: ["alice", "Carol"] }, llm);
    expect(r.textPt).toBeUndefined();
    expect(r.calls).toBe(1);
    expect(r.summary.participantes).toEqual(["Alice", "Bob", "Carol"]);
  });
  it("tenta de novo uma vez se o modelo não devolver JSON; depois falha", async () => {
    let n = 0;
    const llm = async (): Promise<string> => (++n === 1 ? "desculpe, não entendi" : JSON_OK.replace('"en"', '"pt"'));
    const r = await summarizeMeeting(raw, llm);
    expect(r.calls).toBe(2);
    await expect(summarizeMeeting(raw, async () => "nada")).rejects.toThrow(/resumo válido/);
  });
  it("pula a tradução integral acima do teto", async () => {
    const llm = async (system: string): Promise<string> => (system.startsWith("Você") ? JSON_OK : "trad");
    const r = await summarizeMeeting({ ...raw, text: "w ".repeat(1000) }, llm, { translateMaxChars: 100 });
    expect(r.textPt).toBeUndefined();
  });
});
