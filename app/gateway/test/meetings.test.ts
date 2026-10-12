import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeetingsHub } from "@typer/meetings";
import { Gateway } from "../src/gateway.js";
import { FakeChannel } from "../src/fake.js";

let root: string;
let dir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-gw-"));
  dir = await mkdtemp(join(tmpdir(), "typer-gw-reunioes-"));
});

const llm = async (system: string, user: string): Promise<string> =>
  system.startsWith("Você")
    ? JSON.stringify({ titulo: "Sócios — caixa", participantes: ["Israel", "João"], idioma: "pt", resumo: "Revisaram o caixa.", decisoes: ["Cortar 10% dos custos fixos"], pendencias: [{ oQue: "Renegociar aluguel", responsavel: "João", prazo: "30/10" }], proximosPassos: [] })
    : `[pt] ${user}`;

const RESUMO_WA = "Reunião com os sócios\n" + "Discutimos o caixa do mês, o aluguel e os custos fixos. Ficou de cortar 10%.\n".repeat(4);

describe("Gateway + Central de Reuniões (FakeChannel)", () => {
  it("texto encaminhado com 'reunião' entra na central e volta o resumo; duplicado não grava de novo", async () => {
    const hub = new MeetingsHub({ dir, llm });
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", meetings: hub });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: RESUMO_WA });
    expect(ch.sent.map((s) => s.text).join("\n")).toMatch(/Reunião recebida/);
    expect(ch.lastReply()).toContain("📋 Reunião nova — WhatsApp");
    expect(ch.lastReply()).toContain("• Renegociar aluguel — João (30/10)");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    expect(files).toContain("REUNIOES.md");
    expect(files.some((f) => /_whatsapp_socios-caixa\.md$/.test(f))).toBe(true);
    await ch.inject({ senderId: "u1", chatId: "c1", text: RESUMO_WA });
    expect(ch.lastReply()).toMatch(/já estava na central/);
    expect((await readdir(dir)).filter((f) => f.endsWith(".md"))).toHaveLength(2);
  });

  it("pergunta curta com 'reunião' NÃO vira ingestão (vai pro agente)", async () => {
    const hub = new MeetingsHub({ dir, llm });
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", meetings: hub });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "o que ficou da reunião de ontem?" });
    expect(ch.lastReply()).toContain("eco:");
    expect((await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "REUNIOES.md")).toHaveLength(0);
  });

  it("documento .txt com 'reunião' na legenda entra na central com o conteúdo do arquivo", async () => {
    const hub = new MeetingsHub({ dir, llm });
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", meetings: hub });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "reunião de hoje", document: { name: "transcricao.txt", text: "Israel: vamos cortar custos.\nJoão: fechado." } });
    expect(ch.lastReply()).toContain("📋 Reunião nova");
    const all = await hub.list();
    expect(all[0]!.text).toContain("João: fechado.");
    expect(all[0]!.origin).toContain('arquivo "transcricao.txt"');
  });

  it("/reunioes lista, /reunioes status e /reuniao <texto> força a entrada", async () => {
    const hub = new MeetingsHub({ dir, llm });
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", meetings: hub });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/reunioes" });
    expect(ch.lastReply()).toMatch(/Nenhuma reunião na central ainda/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/reuniao decidimos adiar o lançamento" });
    expect(ch.lastReply()).toContain("📋 Reunião nova");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/reunioes" });
    expect(ch.lastReply()).toMatch(/Últimas 1 reunião/);
    expect(ch.lastReply()).toContain("Sócios — caixa");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/reunioes status" });
    expect(ch.lastReply()).toContain(`📂 Central: ${dir} · 1 reunião`);
    expect(ch.lastReply()).toMatch(/Discord: não configurado/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/reunioes sync" });
    expect(ch.lastReply()).toMatch(/Discord: não configurado\n• Drive: não configurado/);
  });

  it("falha do modelo não grava nada e avisa", async () => {
    const hub = new MeetingsHub({ dir, llm: async () => "não sei" });
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", meetings: hub });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: RESUMO_WA });
    expect(ch.lastReply()).toMatch(/não consegui guardar a reunião/);
    expect((await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "REUNIOES.md")).toHaveLength(0);
  });

  it("sem central configurada, /reunioes explica e texto com 'reunião' vai pro agente", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/reunioes" });
    expect(ch.lastReply()).toMatch(/desligada/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: RESUMO_WA });
    expect(ch.lastReply()).toContain("eco:");
  });

  it("remetente não autorizado não consegue injetar reunião", async () => {
    const hub = new MeetingsHub({ dir, llm });
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", meetings: hub });
    await gw.start();
    await ch.inject({ senderId: "intruso", chatId: "c9", text: RESUMO_WA });
    expect(ch.lastReply()).toMatch(/não autorizado/i);
    expect(await hub.list()).toHaveLength(0);
  });
});
