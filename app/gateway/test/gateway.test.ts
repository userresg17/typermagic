import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../src/gateway.js";
import { FakeChannel } from "../src/fake.js";
import { RateLimiter } from "../src/rate-limit.js";

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
