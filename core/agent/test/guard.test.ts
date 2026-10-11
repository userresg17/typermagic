import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appAllowed, checkoutHostAllowed, parseAmountBRL, checkSpend, recordSpend, spentToday, isStopRequested } from "../src/guard.js";

let dir: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ["TYPER_ALLOWED_APPS", "TYPER_CHECKOUT_ALLOW_HOSTS", "TYPER_MAX_PER_TX", "TYPER_MAX_PER_DAY", "TYPER_STOP_FILE", "TYPER_SPEND_LEDGER"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "typer-guard-"));
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.TYPER_SPEND_LEDGER = join(dir, "spend.json");
  process.env.TYPER_STOP_FILE = join(dir, "STOP");
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("guard — allowlists", () => {
  it("apps: default-deny, case-insensitive", () => {
    delete process.env.TYPER_ALLOWED_APPS;
    expect(appAllowed("TextEdit")).toBe(false);
    process.env.TYPER_ALLOWED_APPS = "TextEdit, Brave Browser";
    expect(appAllowed("textedit")).toBe(true);
    expect(appAllowed("Brave Browser")).toBe(true);
    expect(appAllowed("Terminal")).toBe(false);
  });
  it("checkout hosts: exato ou subdomínio, nunca vazio", () => {
    delete process.env.TYPER_CHECKOUT_ALLOW_HOSTS;
    expect(checkoutHostAllowed("https://www.amazon.com.br/checkout").ok).toBe(false);
    process.env.TYPER_CHECKOUT_ALLOW_HOSTS = "amazon.com.br,mercadolivre.com.br";
    expect(checkoutHostAllowed("https://www.amazon.com.br/checkout").ok).toBe(true);
    expect(checkoutHostAllowed("https://amazon.com.br.evil.io/").ok).toBe(false);
    expect(checkoutHostAllowed("não é url").ok).toBe(false);
  });
});

describe("guard — valores e tetos", () => {
  it("parseAmountBRL entende formatos brasileiros e internacionais", () => {
    expect(parseAmountBRL("R$ 1.234,56")).toBe(1234.56);
    expect(parseAmountBRL("1,234.56")).toBe(1234.56);
    expect(parseAmountBRL("R$ 89,90")).toBe(89.9);
    expect(parseAmountBRL("1200")).toBe(1200);
    expect(parseAmountBRL(42)).toBe(42);
    expect(parseAmountBRL("sem valor")).toBeNull();
    expect(parseAmountBRL(undefined)).toBeNull();
  });
  it("teto zero bloqueia tudo; valor desconhecido nega; tetos por tx e por dia", () => {
    process.env.TYPER_MAX_PER_TX = "0";
    expect(checkSpend(10).ok).toBe(false);
    process.env.TYPER_MAX_PER_TX = "500";
    process.env.TYPER_MAX_PER_DAY = "800";
    expect(checkSpend(null).ok).toBe(false);
    expect(checkSpend(600).ok).toBe(false);
    expect(checkSpend(400).ok).toBe(true);
    recordSpend(400);
    expect(spentToday()).toBe(400);
    expect(checkSpend(450).ok).toBe(false); // 850 > 800
    expect(checkSpend(300).ok).toBe(true);
  });
});

describe("guard — kill switch", () => {
  it("arquivo-flag ou AbortSignal param o loop", () => {
    expect(isStopRequested()).toBe(false);
    const ac = new AbortController();
    ac.abort();
    expect(isStopRequested(ac.signal)).toBe(true);
    writeFileSync(join(dir, "STOP"), "");
    expect(existsSync(join(dir, "STOP"))).toBe(true);
    expect(isStopRequested()).toBe(true);
  });
});
