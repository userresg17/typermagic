import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingsHub, formatSummaryMessage } from "../src/hub.js";
import { DiscordClient, type DiscordMessage } from "../src/discord.js";
import { DriveClient } from "../src/google.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "typer-hub-"));
});

const llmJson = (over: Record<string, unknown> = {}) => async (system: string, user: string): Promise<string> =>
  system.startsWith("Você")
    ? JSON.stringify({ titulo: "Reunião teste", participantes: ["Max"], idioma: "pt", resumo: "Resumo.", decisoes: ["D1"], pendencias: [{ oQue: "P1", responsavel: "Max" }], proximosPassos: [], ...over })
    : `[pt] ${user}`;

describe("MeetingsHub.ingest / ingestText", () => {
  it("grava, indexa e avisa; duplicada não avisa de novo", async () => {
    const sent: string[] = [];
    const hub = new MeetingsHub({ dir, llm: llmJson(), notify: async (t) => void sent.push(t) });
    const r = await hub.ingestText("Reunião: sócios\n" + "Falamos de tudo.\n".repeat(5));
    expect(r.duplicate).toBe(false);
    expect(r.meeting.platform).toBe("whatsapp");
    expect(r.message).toContain("📋 Reunião nova — WhatsApp");
    expect(r.message).toContain("• P1 — Max");
    expect(sent).toEqual([r.message]);
    expect(await readFile(join(dir, "REUNIOES.md"), "utf8")).toContain("Reunião teste");
    const again = await hub.ingestText("Reunião: sócios\n" + "Falamos de tudo.\n".repeat(5));
    expect(again.duplicate).toBe(true);
    expect(sent).toHaveLength(1);
  });
  it("texto vazio é erro; modelo sem JSON não grava nada", async () => {
    const hub = new MeetingsHub({ dir, llm: async () => "???" });
    await expect(hub.ingestText("   ")).rejects.toThrow(/sem texto/);
    await expect(hub.ingestText("reunião: x")).rejects.toThrow(/resumo válido/);
    expect(await hub.list()).toHaveLength(0);
  });
  it("formatSummaryMessage cabe no Telegram", async () => {
    const hub = new MeetingsHub({ dir, llm: llmJson({ resumo: "x".repeat(5000) }) });
    const r = await hub.ingestText("reunião: longa");
    expect(formatSummaryMessage(r.meeting).length).toBeLessThanOrEqual(3800);
  });
});

describe("MeetingsHub.pollDiscord", () => {
  const msg = (id: string, content: string, ts: string): DiscordMessage => ({ id, content, timestamp: ts, author: { id: "m", username: "max", global_name: "Max" } });
  const mk = (pages: Record<string, DiscordMessage[]>) => {
    const urls: string[] = [];
    const fetchFn = (async (u: string | URL | Request) => {
      const s = String(u);
      urls.push(s);
      const j = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status });
      if (s.endsWith("/users/@me/guilds")) return j([{ id: "g", name: "G" }]);
      if (s.endsWith("/guilds/g/channels")) return j([{ id: "c1", name: "transcrições", type: 0 }]);
      if (s.includes("/channels/c1/messages")) return j(pages[new URL(s).searchParams.get("after") ?? ""] ?? []);
      return j({}, 404);
    }) as unknown as typeof fetch;
    return { client: new DiscordClient("T", fetchFn), urls };
  };

  it("ingere só lotes assentados, guarda o cursor e não reprocessa", async () => {
    const { client } = mk({
      "": [msg("1", "Reunião: antiga\nblá", "2026-10-11T09:00:00Z"), msg("2", "Reunião: recente\nblá", "2026-10-11T09:58:00Z")],
      "1": [msg("2", "Reunião: recente\nblá", "2026-10-11T09:58:00Z")],
      "2": [],
    });
    let now = new Date("2026-10-11T10:00:00Z");
    const hub = new MeetingsHub({ dir, llm: llmJson(), discord: { client, channelName: "transcrições" }, now: () => now });
    const r1 = await hub.pollDiscord();
    expect(r1).toEqual({ ingested: 1, pending: 1 });
    expect((await hub.state()).discord).toMatchObject({ channelId: "c1", lastId: "1" });
    now = new Date("2026-10-11T10:30:00Z");
    const r2 = await hub.pollDiscord();
    expect(r2).toEqual({ ingested: 1, pending: 0 });
    expect((await hub.state()).discord?.lastId).toBe("2");
    expect(await hub.list()).toHaveLength(2);
  });

  it("conteúdo vazio aponta o Message Content Intent; pollOnce isola o erro", async () => {
    const { client } = mk({ "": [{ id: "5", content: "", timestamp: "2026-10-11T09:00:00Z", author: { id: "m", username: "max" } }] });
    const hub = new MeetingsHub({ dir, llm: llmJson(), discord: { client, channelName: "transcrições" } });
    const r = await hub.pollOnce();
    expect(r.discord).toMatchObject({ error: expect.stringMatching(/Message Content Intent/) });
    expect((await hub.state()).discord?.lastError).toMatch(/Intent/);
  });

  it("canal inexistente é erro claro", async () => {
    const { client } = mk({});
    const hub = new MeetingsHub({ dir, llm: llmJson(), discord: { client, channelName: "nao-existe" } });
    await expect(hub.pollDiscord()).rejects.toThrow(/não encontrado/);
  });
});

describe("MeetingsHub.pollDrive", () => {
  it("ingere docs quietos há 10 min, pula os recém-modificados e avança o since", async () => {
    const files = [
      { id: "f1", name: "Kickoff - Notes by Gemini", createdTime: "2026-10-11T09:00:00Z", modifiedTime: "2026-10-11T09:30:00Z" },
      { id: "f2", name: "Em andamento - Notes by Gemini", createdTime: "2026-10-11T09:55:00Z", modifiedTime: "2026-10-11T09:58:00Z" },
    ];
    const fetchFn = (async (u: string | URL | Request) => {
      const s = String(u);
      if (s.includes("/files?")) return new Response(JSON.stringify({ files }), { status: 200 });
      if (s.includes("/files/f1/export")) return new Response("Attendees: Max\nWe decided X.", { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const client = new DriveClient({ accessToken: async () => "T" }, fetchFn);
    const hub = new MeetingsHub({ dir, llm: llmJson({ idioma: "en" }), drive: { client }, now: () => new Date("2026-10-11T10:00:00Z") });
    const r = await hub.pollDrive();
    expect(r.ingested).toBe(1);
    const all = await hub.list();
    expect(all[0]!.summary.titulo).toBe("Reunião teste");
    expect(all[0]!.textPt).toContain("[pt] ");
    expect((await hub.state()).drive?.since).toBe("2026-10-11T09:30:00Z");
    // 2ª rodada: f1 já ingerida (dedupe), f2 ainda quente
    expect((await hub.pollDrive()).ingested).toBe(0);
  });
});
