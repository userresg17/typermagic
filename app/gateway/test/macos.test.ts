// Fase 4 (macOS): /parar, confirmação por botão inline, handoff com foto, /continuar e /status.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../src/gateway.js";
import { FakeChannel } from "../src/fake.js";

let root: string;
const saved = { stop: process.env.TYPER_STOP_FILE, ledger: process.env.TYPER_SPEND_LEDGER };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-gwm-"));
  process.env.TYPER_STOP_FILE = join(root, "STOP");
  process.env.TYPER_SPEND_LEDGER = join(root, "spend.json");
});
afterEach(() => {
  if (saved.stop === undefined) delete process.env.TYPER_STOP_FILE;
  else process.env.TYPER_STOP_FILE = saved.stop;
  if (saved.ledger === undefined) delete process.env.TYPER_SPEND_LEDGER;
  else process.env.TYPER_SPEND_LEDGER = saved.ledger;
});

type Priv = {
  approveViaChannel(chatId: string, req: { action: string; target: string; detail?: string }): Promise<boolean>;
  handoffViaChannel(chatId: string, reason: string, png?: string): Promise<"ok" | "cancelar">;
};

describe("gateway macOS — kill switch e confirmação por botão", () => {
  it("/parar sem tarefa responde; com arquivo STOP a tarefa não roda; /continuar libera", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/parar" });
    expect(ch.lastReply()).toMatch(/Nenhuma tarefa/);
    await writeFile(join(root, "STOP"), "");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "oi" });
    expect(ch.lastReply()).toMatch(/Arquivo STOP presente/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/continuar" });
    expect(ch.lastReply()).toMatch(/removido/);
    expect(existsSync(join(root, "STOP"))).toBe(false);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "oi de novo" });
    expect(ch.lastReply()).toContain("eco: oi de novo");
  });

  it("/parar de remetente não autorizado é negado", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "intruso", chatId: "c1", text: "/parar" });
    expect(ch.lastReply()).toMatch(/não autorizado/i);
  });

  it("confirmação: cartão estruturado com botões; botão ✅ aprova, 🚫 cancela, texto 'não' cancela", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    const priv = gw as unknown as Priv;
    const detail = "Ação: Pagar tênis\nValor: R$ 250,00\nVendedor/destinatário: Loja X\nEndereço: Rua A, 1\nSite: https://loja.com.br/checkout";
    const p1 = priv.approveViaChannel("c1", { action: "tool", target: "x", detail });
    await new Promise((r) => setTimeout(r, 5));
    const card = ch.sent.at(-1)!;
    expect(card.text).toContain("• Valor: R$ 250,00");
    expect(card.text).toContain("• Vendedor/destinatário: Loja X");
    expect(card.text).toContain("• Endereço: Rua A, 1");
    expect(card.buttons?.[0]?.map((b) => b.data)).toEqual(["ok", "cancel"]);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "ok", isCallback: true });
    expect(await p1).toBe(true);
    expect(ch.lastReply()).toBe("✅ Confirmado.");

    const p2 = priv.approveViaChannel("c1", { action: "tool", target: "x", detail });
    await new Promise((r) => setTimeout(r, 5));
    await ch.inject({ senderId: "u1", chatId: "c1", text: "cancel", isCallback: true });
    expect(await p2).toBe(false);

    const p3 = priv.approveViaChannel("c1", { action: "tool", target: "x", detail });
    await new Promise((r) => setTimeout(r, 5));
    await ch.inject({ senderId: "u1", chatId: "c1", text: "não" });
    expect(await p3).toBe(false);
  });

  it("handoff manda a FOTO com motivo e botões; ok continua, cancelar encerra, intruso não resolve", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    const priv = gw as unknown as Priv;
    const p1 = priv.handoffViaChannel("c1", "CAPTCHA na página", "QUJD");
    await new Promise((r) => setTimeout(r, 5));
    const photo = ch.photos.at(-1)!;
    expect(photo.png).toBe("QUJD");
    expect(photo.caption).toContain("CAPTCHA na página");
    expect(photo.buttons?.[0]?.[0]?.data).toBe("ok");
    await ch.inject({ senderId: "intruso", chatId: "c1", text: "ok", isCallback: true });
    await ch.inject({ senderId: "u1", chatId: "c1", text: "ok", isCallback: true });
    expect(await p1).toBe("ok");
    const p2 = priv.handoffViaChannel("c1", "login");
    await new Promise((r) => setTimeout(r, 5));
    await ch.inject({ senderId: "u1", chatId: "c1", text: "cancel", isCallback: true });
    expect(await p2).toBe("cancelar");
  });

  it("/status mostra desktop, STOP e gasto do dia", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, {
      root,
      allow: ["u1"],
      provider: "fake",
      openDesktop: () =>
        ({
          name: "macos",
          async tcc() {
            return { screen_recording: true, accessibility: false, binary: "/py", instructions: ["Accessibility: conceda"] };
          },
          async close() {},
        }) as never,
    });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/status" });
    const t = ch.lastReply();
    expect(t).toContain("Desktop: on");
    expect(t).toContain("Screen Recording ✓");
    expect(t).toContain("Accessibility ✗");
    expect(t).toContain("Gasto hoje");
    expect(t).toContain("Arquivo STOP: ausente");
  });
});

describe("gateway macOS — aprendizado por tutorial (Fase 7)", () => {
  it("/skills sem nada lista vazio; com uma candidata em .typer/skills mostra 🟡 e detalha por id", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/skills" });
    expect(ch.lastReply()).toMatch(/Nenhuma skill ainda/);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".typer", "skills", "app-exportar"), { recursive: true });
    await writeFile(
      join(root, ".typer", "skills", "app-exportar", "SKILL.md"),
      '---\nid: app-exportar\nname: Exportar\ndescription: Exporta.\ncodeVersion: gui\nsealed: false\ncreatedAt: 2026-10-11T00:00:00Z\nkind: gui\napp: App\nstate: candidate\nsteps: [{"n":1,"intent":"Abrir Deliver","how":"aba","verify":"ok"}]\n---\n\n# Exportar\n',
    );
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/skills" });
    expect(ch.lastReply()).toContain("🟡 app-exportar");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/skills app-exportar" });
    expect(ch.lastReply()).toContain("[candidate]");
    expect(ch.lastReply()).toContain("1. Abrir Deliver");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/skills nao-existe" });
    expect(ch.lastReply()).toMatch(/não encontrada/);
  });

  it("/aprender sem URL explica o uso; com STOP não roda; intruso é negado", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/aprender" });
    expect(ch.lastReply()).toMatch(/Uso: \/aprender/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/aprender naoeurl" });
    expect(ch.lastReply()).toMatch(/Uso: \/aprender/);
    await writeFile(join(root, "STOP"), "");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/aprender https://youtu.be/XXXXXXXXXXX" });
    expect(ch.lastReply()).toMatch(/STOP presente/);
    await ch.inject({ senderId: "intruso", chatId: "c2", text: "/aprender https://youtu.be/XXXXXXXXXXX" });
    expect(ch.lastReply()).toMatch(/não autorizado/i);
  });

  it("/aprender com provider fake falha com erro claro (sem modelo), sem derrubar o gateway", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/aprender https://youtu.be/XXXXXXXXXXX DaVinci" });
    expect(ch.lastReply()).toMatch(/não consegui aprender|sem provider/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "oi" });
    expect(ch.lastReply()).toContain("eco: oi");
  });
});

describe("gateway macOS — ensaio (Fase 8)", () => {
  it("/ensaiar: uso, id inexistente, skill sem passos e gateway sem desktop", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/ensaiar" });
    expect(ch.lastReply()).toMatch(/Uso: \/ensaiar/);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/ensaiar nao-existe" });
    expect(ch.lastReply()).toMatch(/não encontrada/);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".typer", "skills", "s-gui"), { recursive: true });
    await writeFile(
      join(root, ".typer", "skills", "s-gui", "SKILL.md"),
      '---\nid: s-gui\nname: X\ndescription: d\ncodeVersion: gui\nsealed: false\ncreatedAt: 2026-10-11T00:00:00Z\nkind: gui\napp: TextEdit\nstate: candidate\nsteps: [{"n":1,"intent":"a","how":"b","verify":"c"}]\n---\n\n# X\n',
    );
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/ensaiar s-gui" });
    expect(ch.lastReply()).toMatch(/Desktop desligado/);
    await mkdir(join(root, ".typer", "skills", "s-legacy"), { recursive: true });
    await writeFile(join(root, ".typer", "skills", "s-legacy", "SKILL.md"), "---\nid: s-legacy\nname: L\ndescription: d\ncodeVersion: v1\nsealed: false\ncreatedAt: 2026-10-11T00:00:00Z\n---\n\ntexto\n");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/ensaiar s-legacy" });
    expect(ch.lastReply()).toMatch(/não é de GUI/);
  });
});
