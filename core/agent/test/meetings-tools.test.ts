import { describe, it, expect } from "vitest";
import { meetingsTools, meetingsSkillSection, type MeetingsDep, type MeetingLike } from "../src/tools/meetings.js";
import { buildDefaultRegistry } from "../src/tools/index.js";
import type { ToolContext } from "../src/tools/types.js";

const m = (id: string, titulo: string, platform = "discord"): MeetingLike => ({
  id,
  file: `/tmp/${id}.md`,
  date: "2026-10-11T10:00:00-03:00",
  platform,
  text: "texto original",
  summary: { titulo, participantes: ["Max"], idioma: "pt", resumo: "r", decisoes: ["d"], pendencias: [{ oQue: "p", responsavel: "Max" }], proximosPassos: [] },
});
const dep: MeetingsDep = {
  dir: "/tmp/reunioes",
  search: async (q, o) => (q.includes("dev") ? [{ meeting: m("a", "Sprint", o?.platform ?? "discord"), score: 3, snippet: "trecho" }] : []),
  read: async (id) => (id === "a" ? { ...m("a", "Sprint"), textPt: "traduzido" } : null),
  list: async () => [m("a", "Sprint"), m("b", "Sócios", "whatsapp")],
};
const ctx = (deps?: Partial<ToolContext["deps"]>): ToolContext => ({
  workspace: "/tmp",
  origin: "agent",
  approve: async () => true,
  audit: () => {},
  seal: { verify: async () => ({ passed: true }) },
  ...(deps ? { deps } : {}),
});
const tool = (name: string) => meetingsTools.find((t) => t.name === name)!;

describe("ferramentas reunioes_*", () => {
  it("estão no registry, são só-leitura e in_process (passam no grant READONLY)", () => {
    const reg = buildDefaultRegistry();
    for (const n of ["reunioes_buscar", "reunioes_listar", "reunioes_ler"]) {
      const t = reg.get(n)!;
      expect(t.permission).toBe("read");
      expect(t.exec).toBe("in_process");
      expect(t.requiresApproval).toBe(false);
    }
    expect(meetingsSkillSection(reg.all())).toContain("reunioes_buscar");
    expect(meetingsSkillSection([])).toBe("");
  });
  it("sem a central injetada, falha com mensagem clara", async () => {
    const r = await tool("reunioes_buscar").handler({ consulta: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("meetings_unavailable");
  });
  it("buscar devolve resumo + trecho; filtra plataforma", async () => {
    const r = await tool("reunioes_buscar").handler({ consulta: "time de dev", plataforma: "discord", k: 3 }, ctx({ meetings: dep }));
    expect(r.ok).toBe(true);
    const v = r.value as { total: number; reunioes: Array<{ id: string; trecho: string; decisoes: string[] }> };
    expect(v.total).toBe(1);
    expect(v.reunioes[0]).toMatchObject({ id: "a", trecho: "trecho", decisoes: ["d"] });
  });
  it("listar e ler (completa usa a tradução quando existe)", async () => {
    const l = await tool("reunioes_listar").handler({ n: 1, plataforma: "whatsapp" }, ctx({ meetings: dep }));
    expect((l.value as { reunioes: Array<{ id: string }> }).reunioes.map((x) => x.id)).toEqual(["b"]);
    const r = await tool("reunioes_ler").handler({ id: "a", parte: "completa" }, ctx({ meetings: dep }));
    expect((r.value as { transcricao: string }).transcricao).toBe("traduzido");
    const nf = await tool("reunioes_ler").handler({ id: "zz" }, ctx({ meetings: dep }));
    expect(nf.ok).toBe(false);
  });
});
