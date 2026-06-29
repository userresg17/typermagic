import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../src/gateway.js";
import { FakeChannel } from "../src/fake.js";
import { RateLimiter } from "../src/rate-limit.js";
import { PendingStore } from "../src/pending.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-gw-"));
});

describe("Gateway (FakeChannel, provider fake)", () => {
  it("remetente AUTORIZADO recebe a resposta da Engine", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "oi agente" });
    expect(ch.lastReply()).toContain("eco: oi agente");
  });

  it("remetente NÃO autorizado é recusado (default-deny)", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    await ch.inject({ senderId: "intruso", chatId: "c1", text: "me deixa entrar" });
    expect(ch.lastReply()).toMatch(/não autorizado/i);
  });

  it("rate-limit recusa após estourar o balde do remetente", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", rateCapacity: 2, rateRefillMs: 9_999_999 });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "1" });
    await ch.inject({ senderId: "u1", chatId: "c1", text: "2" });
    await ch.inject({ senderId: "u1", chatId: "c1", text: "3" });
    expect(ch.lastReply()).toMatch(/muitas mensagens/i);
  });
});

describe("RateLimiter", () => {
  it("consome e reabastece com o tempo", () => {
    let t = 0;
    const rl = new RateLimiter(1, 1000, () => t);
    expect(rl.allow("u")).toBe(true);
    expect(rl.allow("u")).toBe(false);
    t = 1000;
    expect(rl.allow("u")).toBe(true);
  });
  it("baldes são por remetente", () => {
    const rl = new RateLimiter(1, 9_999_999);
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("b")).toBe(true);
    expect(rl.allow("a")).toBe(false);
  });
});

describe("PendingStore (perguntar e esperar)", () => {
  it("wait resolve quando a resposta chega", async () => {
    const ps = new PendingStore();
    const p = ps.wait("c1", "approval", 1000);
    expect(ps.has("c1")).toBe(true);
    expect(ps.resolve("c1", "sim")).toBe(true);
    expect(await p).toBe("sim");
    expect(ps.has("c1")).toBe(false);
  });
  it("resolve sem pendência → false", () => {
    expect(new PendingStore().resolve("c1", "x")).toBe(false);
  });
  it("timeout rejeita (default-deny)", async () => {
    await expect(new PendingStore().wait("c1", "otp", 5)).rejects.toThrow(/timeout/);
  });
  it("nova pergunta cancela a anterior (uma por chat)", async () => {
    const ps = new PendingStore();
    const first = ps.wait("c1", "approval", 1000);
    const second = ps.wait("c1", "clarify", 1000);
    await expect(first).rejects.toThrow(/substituída/);
    expect(ps.resolve("c1", "ok")).toBe(true);
    expect(await second).toBe("ok");
  });
  it("cancel rejeita a pendência", async () => {
    const ps = new PendingStore();
    const p = ps.wait("c1", "approval", 1000);
    ps.cancel("c1", "shutdown");
    await expect(p).rejects.toThrow(/shutdown/);
  });
});

describe("Gateway comandos do cofre (/set, /vault) — valor nunca vai ao modelo", () => {
  beforeEach(async () => {
    process.env.TYPER_VAULT_DIR = await mkdtemp(join(tmpdir(), "typer-gw-vault-"));
    delete process.env.TYPER_VAULT_KEY;
  });

  it("/set grava no cofre e /vault mostra redigido (cartão final-4)", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", vault: true });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/set card_number 4111111111111234" });
    expect(ch.lastReply()).toMatch(/guardado/i);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/vault" });
    expect(ch.lastReply()).toContain("•••• 1234");
    expect(ch.lastReply()).not.toContain("4111111111111234");
  });

  it("/status responde a saúde do assistente", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", features: { tools: true, memory: true }, vault: true });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/status" });
    expect(ch.lastReply()).toMatch(/Status do assistente/);
    expect(ch.lastReply()).toMatch(/Mem[oó]ria: on/);
  });

  it("/forget apaga o campo", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake", vault: true });
    await gw.start();
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/set email a@b.com" });
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/forget email" });
    expect(ch.lastReply()).toMatch(/apagado/i);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "/vault" });
    expect(ch.lastReply()).not.toContain("a@b.com");
  });
});

describe("Gateway HITL (askUser reentrante)", () => {
  it("pergunta e a PRÓXIMA mensagem do chat resolve (não trava o loop)", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    const answer = gw.askUser("c1", "approval", "Confirma a compra?");
    expect(ch.lastReply()).toBe("Confirma a compra?");
    await ch.inject({ senderId: "u1", chatId: "c1", text: "sim" });
    expect(await answer).toBe("sim");
  });
  it("resposta de remetente NÃO autorizado não resolve a pendência", async () => {
    const ch = new FakeChannel();
    const gw = new Gateway(ch, { root, allow: ["u1"], provider: "fake" });
    await gw.start();
    const answer = gw.askUser("c1", "approval", "Confirma?");
    await ch.inject({ senderId: "intruso", chatId: "c1", text: "sim" });
    expect(ch.lastReply()).toMatch(/não autorizado/i);
    await ch.inject({ senderId: "u1", chatId: "c1", text: "sim" });
    expect(await answer).toBe("sim");
  });
});
