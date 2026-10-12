import { describe, it, expect } from "vitest";
import { DiscordClient, groupBatches, isSettled, batchToRaw, type DiscordMessage } from "../src/discord.js";

const msg = (id: string, content: string, ts: string, author = "max", extra: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id,
  content,
  timestamp: ts,
  author: { id: author, username: author, global_name: author === "max" ? "Max" : null },
  ...extra,
});

describe("groupBatches — colagem em várias mensagens vira um lote", () => {
  it("junta mensagens seguidas do mesmo autor; separa por autor ou intervalo", () => {
    const b = groupBatches([
      msg("1", "parte 1", "2026-10-11T10:00:00Z"),
      msg("2", "parte 2", "2026-10-11T10:01:00Z"),
      msg("3", "oi", "2026-10-11T10:02:00Z", "ana"),
      msg("4", "outra reunião", "2026-10-11T12:00:00Z"),
    ]);
    expect(b.map((x) => x.messages.map((m) => m.id))).toEqual([["1", "2"], ["3"], ["4"]]);
    expect(b[0]!.authorName).toBe("Max");
  });
  it("ignora mensagens vazias sem anexo de texto; ordena por id", () => {
    const b = groupBatches([msg("9", "b", "2026-10-11T10:05:00Z"), msg("8", "", "2026-10-11T10:04:00Z"), msg("7", "a", "2026-10-11T10:03:00Z")]);
    expect(b).toHaveLength(1);
    expect(b[0]!.messages.map((m) => m.id)).toEqual(["7", "9"]);
  });
  it("lote só assenta depois do intervalo", () => {
    const [b] = groupBatches([msg("1", "x", "2026-10-11T10:00:00Z")]);
    expect(isSettled(b!, new Date("2026-10-11T10:05:00Z"))).toBe(false);
    expect(isSettled(b!, new Date("2026-10-11T10:11:00Z"))).toBe(true);
  });
});

describe("batchToRaw", () => {
  it("monta a reunião com título da 1ª linha, anexo baixado e chave da 1ª mensagem", async () => {
    const [b] = groupBatches([
      msg("10", "Reunião: Kickoff do app\nMax: começamos segunda.", "2026-10-11T10:00:00Z"),
      msg("11", "", "2026-10-11T10:00:30Z", "max", { attachments: [{ id: "a", filename: "transcricao.txt", size: 10, url: "https://cdn/x.txt", content_type: "text/plain" }] }),
    ]);
    const raw = await batchToRaw(b!, { fetchText: async () => "Israel: fechado." }, "transcrições");
    expect(raw.sourceKey).toBe("discord:10");
    expect(raw.title).toBe("Kickoff do app");
    expect(raw.text).toContain("[anexo transcricao.txt]\nIsrael: fechado.");
    expect(raw.origin).toBe("Discord #transcrições (colado por Max)");
    expect(raw.date).toBe("2026-10-11T10:00:00.000Z");
  });
});

describe("DiscordClient (fetch falso)", () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bot T");
    const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (u.endsWith("/users/@me/guilds")) return json([{ id: "g1", name: "Empresa" }]);
    if (u.endsWith("/guilds/g1/channels")) return json([{ id: "c9", name: "geral", type: 0 }, { id: "c1", name: "transcrições", type: 0 }, { id: "v1", name: "voz", type: 2 }]);
    if (u.includes("/channels/c1/messages")) {
      const after = new URL(u).searchParams.get("after");
      if (!after) return json(Array.from({ length: 100 }, (_, i) => msg(String(100 + i), `m${i}`, "2026-10-11T10:00:00Z")).reverse());
      if (after === "199") return json([msg("200", "last", "2026-10-11T10:00:00Z")]);
      return json([]);
    }
    return json({ message: "nope" }, 404);
  }) as unknown as typeof fetch;

  it("acha o canal pelo nome sem acento e pagina as mensagens em ordem", async () => {
    const c = new DiscordClient("T", fakeFetch);
    const found = await c.findChannel("Transcricoes");
    expect(found?.channel.id).toBe("c1");
    const msgs = await c.messagesAfter("c1", null);
    expect(msgs).toHaveLength(101);
    expect(msgs[0]!.id).toBe("100");
    expect(msgs[100]!.id).toBe("200");
  });
  it("erro HTTP vira exceção legível", async () => {
    const c = new DiscordClient("T", fakeFetch);
    await expect(c.messagesAfter("zz", null)).rejects.toThrow(/Discord 404/);
  });
  it("exige token", () => {
    expect(() => new DiscordClient("")).toThrow();
  });
});
