import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingStore, renderMeeting, parseMeeting, renderIndex, withLock, INDEX_FILE } from "../src/store.js";
import type { RawMeeting, Summary } from "../src/types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "typer-reunioes-"));
});

const raw = (over: Partial<RawMeeting> = {}): RawMeeting => ({
  sourceKey: "discord:1",
  platform: "discord",
  date: "2026-10-11T14:30:00.000Z",
  title: "Planejamento sprint",
  text: "Max: vamos fechar a API de pagamentos até sexta.\nIsrael: ok, e o deploy fica com o Max.",
  origin: "Discord #transcrições (colado por Max)",
  ...over,
});
const summary = (over: Partial<Summary> = {}): Summary => ({
  titulo: "Planejamento sprint",
  participantes: ["Max", "Israel"],
  idioma: "pt",
  resumo: "Alinhamento da sprint: API de pagamentos até sexta.",
  decisoes: ["Fechar a API de pagamentos até sexta"],
  pendencias: [{ oQue: "Fazer o deploy", responsavel: "Max", prazo: "sexta" }],
  proximosPassos: ["Revisar o backlog"],
  ...over,
});

describe("MeetingStore — arquivo, índice, dedupe", () => {
  it("salva um .md legível, reconstrói o índice e lê de volta igual", async () => {
    const store = new MeetingStore(dir);
    const { meeting, duplicate } = await store.save(raw(), summary());
    expect(duplicate).toBe(false);
    expect(meeting.id).toMatch(/^2026-10-11_\d{4}_discord_planejamento-sprint$/);
    const content = await readFile(meeting.file, "utf8");
    expect(content).toContain("# Planejamento sprint");
    expect(content).toContain("- [ ] Fazer o deploy — **Max** (prazo: sexta)");
    expect(content).toContain("## Transcrição completa");
    const back = parseMeeting(content, meeting.file)!;
    expect(back.summary).toEqual(summary());
    expect(back.text).toBe(raw().text);
    expect(back.sourceKey).toBe("discord:1");
    const idx = await readFile(join(dir, INDEX_FILE), "utf8");
    expect(idx).toContain("1 reunião(ões)");
    expect(idx).toContain("Planejamento sprint");
    expect(idx).toContain("• Fazer o deploy — Max (sexta)");
  });

  it("mesma sourceKey não grava de novo", async () => {
    const store = new MeetingStore(dir);
    const a = await store.save(raw(), summary());
    const b = await store.save(raw(), summary({ titulo: "outro" }));
    expect(b.duplicate).toBe(true);
    expect(b.meeting.id).toBe(a.meeting.id);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md") && f !== INDEX_FILE);
    expect(files).toHaveLength(1);
  });

  it("título igual na mesma hora ganha sufixo -2", async () => {
    const store = new MeetingStore(dir);
    const a = await store.save(raw(), summary());
    const b = await store.save(raw({ sourceKey: "discord:2" }), summary());
    expect(b.meeting.id).toBe(`${a.meeting.id}-2`);
  });

  it("guarda a tradução quando o original não é pt", async () => {
    const store = new MeetingStore(dir);
    const { meeting } = await store.save(raw({ text: "We ship Friday." }), summary({ idioma: "en" }), "Entregamos sexta.");
    const back = parseMeeting(await readFile(meeting.file, "utf8"), meeting.file)!;
    expect(back.textPt).toBe("Entregamos sexta.");
    expect(back.text).toBe("We ship Friday.");
  });

  it("list ordena mais recente primeiro; read por id; ignora lixo na pasta", async () => {
    const store = new MeetingStore(dir);
    await store.save(raw({ sourceKey: "a", date: "2026-10-01T10:00:00Z" }), summary({ titulo: "antiga" }));
    await store.save(raw({ sourceKey: "b", date: "2026-10-09T10:00:00Z" }), summary({ titulo: "nova" }));
    const all = await store.list();
    expect(all.map((m) => m.summary.titulo)).toEqual(["nova", "antiga"]);
    expect((await store.read(all[1]!.id))?.summary.titulo).toBe("antiga");
    expect(await store.read("../../etc/passwd")).toBeNull();
  });
});

describe("MeetingStore.search — busca lexical", () => {
  it("acha por decisão/participante e filtra por plataforma e data", async () => {
    const store = new MeetingStore(dir);
    await store.save(raw({ sourceKey: "d1" }), summary());
    await store.save(
      raw({ sourceKey: "w1", platform: "whatsapp", date: "2026-10-05T10:00:00Z", text: "Sócios: vamos abrir a filial em Curitiba em janeiro." }),
      summary({ titulo: "Sócios — expansão", participantes: ["Israel", "João"], decisoes: ["Abrir filial em Curitiba em janeiro"], pendencias: [] }),
    );
    const hits = await store.search("filial Curitiba");
    expect(hits[0]!.meeting.summary.titulo).toBe("Sócios — expansão");
    expect(hits[0]!.snippet).toMatch(/Curitiba/);
    expect(await store.search("deploy", { platform: "whatsapp" })).toHaveLength(0);
    expect((await store.search("deploy", { platform: "discord" }))[0]!.meeting.summary.titulo).toBe("Planejamento sprint");
    expect(await store.search("filial", { since: "2026-10-06" })).toHaveLength(0);
    expect(await store.search("filial", { until: "2026-10-06" })).toHaveLength(1);
  });
  it("consulta vazia lista as mais recentes", async () => {
    const store = new MeetingStore(dir);
    await store.save(raw(), summary());
    expect(await store.search("")).toHaveLength(1);
  });
});

describe("render/parse e lock", () => {
  it("renderIndex sem reuniões", () => {
    expect(renderIndex([])).toContain("0 reunião(ões)");
  });
  it("renderMeeting → parseMeeting é idempotente", () => {
    const m = { ...raw(), id: "x", file: "/tmp/x.md", summary: summary(), ingestedAt: "2026-10-11T15:00:00-03:00" };
    const back = parseMeeting(renderMeeting(m), "/tmp/x.md")!;
    expect(renderMeeting({ ...back, ingestedAt: m.ingestedAt })).toBe(renderMeeting(m));
  });
  it("withLock serializa e libera", async () => {
    const order: number[] = [];
    await Promise.all([
      withLock(dir, async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 50));
        order.push(2);
      }),
      withLock(dir, async () => {
        order.push(3);
      }),
    ]);
    // quem pega o lock primeiro varia; o que importa é que 3 nunca entra entre 1 e 2
    expect(order.join("")).toMatch(/^(123|312)$/);
  });
});
