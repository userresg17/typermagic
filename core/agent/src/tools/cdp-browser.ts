// core/agent/tools/cdp-browser.ts
// Sessão de navegador do fluxo macOS: Brave/Chrome REAL do usuário, num PERFIL DEDICADO, via CDP
// (--remote-debugging-port). Sem stealth, sem user-agent falso, sem movimento "humano" — o
// navegador se apresenta como é. CAPTCHA/anti-bot → handoff humano (browser/agent.ts).
// Percepção: DOM numerado (mesmo EXTRACT_FN do playwright-browser) + acessibilidade (aria
// snapshot) + screenshot set-of-marks. Entrada: Playwright direto (locator.click/fill, mouse).
//
// Por que um arquivo novo e não um flag no playwright-browser.ts: o arquivo original fica
// intocado (decisão do dono); este caminho simplesmente não chama applyStealth/humanMoveTo/
// pressAndHold/real-mouse.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserSession, InteractiveElement, PageState } from "./types.js";
import { EXTRACT_FN } from "./playwright-browser.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CdpBrowserOptions {
  /** binário do navegador real. Default: $TYPER_BROWSER_PATH → Brave → Chrome */
  executablePath?: string;
  /** perfil DEDICADO (nunca o pessoal). Default: $TYPER_BROWSER_PROFILE ou ~/.typer/browser/cdp-profile */
  profileDir?: string;
  /** porta CDP. Default: $TYPER_CDP_PORT ou 9222 */
  port?: number;
  timeoutMs?: number;
  /** não lança o navegador: só conecta (ex.: você já abriu com --remote-debugging-port) */
  connectOnly?: boolean;
}

const MAC_BROWSERS = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export function findMacBrowser(): string | undefined {
  const env = process.env.TYPER_BROWSER_PATH;
  if (env && existsSync(env)) return env;
  return MAC_BROWSERS.find((p) => existsSync(p));
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

export function defaultCdpProfile(): string {
  return expandHome(process.env.TYPER_BROWSER_PROFILE ?? join(homedir(), ".typer", "browser", "cdp-profile"));
}

/** recusa perfis pessoais: o agente nunca dirige o seu navegador do dia a dia. */
export function isPersonalProfile(dir: string): boolean {
  const d = expandHome(dir).toLowerCase();
  return /library\/application support\/(bravesoftware|google\/chrome|chromium|microsoft edge)/.test(d);
}

async function cdpAlive(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = (await r.json()) as { webSocketDebuggerUrl?: string };
    return j.webSocketDebuggerUrl ?? `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

async function launchBrowser(exe: string, profile: string, port: number): Promise<void> {
  mkdirSync(profile, { recursive: true });
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--window-size=1280,900",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(port)) return;
  }
  throw new Error(`navegador não abriu a porta CDP ${port} em 30s`);
}

async function loadChromium(): Promise<any> {
  const spec = "playwright";
  const pw: any = await import(spec);
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright não instalado — rode: pnpm install");
  return chromium;
}

class CdpSession implements BrowserSession {
  constructor(
    private readonly context: any,
    private page: any,
    private readonly timeoutMs: number,
  ) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }
  async text(): Promise<string> {
    const t: string = await this.page.innerText("body").catch(() => "");
    return t.replace(/\n{3,}/g, "\n\n").slice(0, 15_000);
  }
  /** resumo de ACESSIBILIDADE da página (aria snapshot do Playwright), truncado. */
  async accessibility(): Promise<string> {
    try {
      const snap: string = await this.page.locator("body").ariaSnapshot({ timeout: 3000 });
      return snap.slice(0, 1500);
    } catch {
      return "";
    }
  }
  async click(selector: string): Promise<void> {
    await this.page.click(selector, { timeout: this.timeoutMs });
  }
  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value, { timeout: this.timeoutMs });
  }
  async select(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value, { timeout: this.timeoutMs });
  }
  async screenshot(): Promise<string> {
    const buf: Buffer = await this.page.screenshot({ type: "png" });
    return buf.toString("base64");
  }
  async screenshotMarked(): Promise<string> {
    await this.page
      .evaluate(() => {
        const g = globalThis as any;
        const doc = g.document;
        if (!doc?.body) return;
        doc.querySelectorAll("[data-typer-idx]").forEach((el: any) => {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          const tag = doc.createElement("div");
          tag.className = "__typer_mark";
          tag.textContent = el.getAttribute("data-typer-idx");
          tag.style.cssText =
            `position:fixed;z-index:2147483646;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;` +
            "background:#ff0066;color:#fff;font:bold 11px monospace;padding:0 2px;border-radius:2px;line-height:14px;pointer-events:none;box-shadow:0 0 0 1px #fff;";
          doc.body.appendChild(tag);
        });
      })
      .catch(() => {});
    let b64 = "";
    try {
      b64 = (await this.page.screenshot({ type: "png" })).toString("base64");
    } catch {
      /* segue sem imagem */
    }
    await this.page.evaluate(() => (globalThis as any).document?.querySelectorAll(".__typer_mark").forEach((e: any) => e.remove())).catch(() => {});
    return b64;
  }
  async url(): Promise<string> {
    return this.page.url();
  }
  async isAlive(): Promise<boolean> {
    try {
      await Promise.race([this.page.evaluate(() => true), new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
      return true;
    } catch {
      return false;
    }
  }
  async submit(selector: string): Promise<void> {
    await this.page.click(selector, { timeout: this.timeoutMs }).catch(() => {});
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }
  async state(): Promise<PageState> {
    const url = this.page.url();
    const title = await this.page.title().catch(() => "");
    const ax = await this.accessibility();
    const body = await this.text();
    // ordem: DOM numerado (elements) → acessibilidade → texto. O screenshot vem em screenshotMarked().
    const text = ax ? `ACESSIBILIDADE:\n${ax}\n\nTEXTO:\n${body}` : body;
    const elements: InteractiveElement[] = [];
    for (const frame of this.page.frames()) {
      try {
        const part = (await frame.evaluate(EXTRACT_FN, elements.length)) as InteractiveElement[];
        for (const e of part) elements.push(e);
      } catch {
        /* frame cross-origin: ignora */
      }
    }
    return { url, title, text, elements };
  }
  private async locByIndex(idx: number): Promise<any | null> {
    const sel = `[data-typer-idx="${idx}"]`;
    for (const frame of this.page.frames()) {
      const loc = frame.locator(sel);
      if (await loc.count().catch(() => 0)) return loc.first();
    }
    return null;
  }
  private async switchToNewTabIfAny(before: number): Promise<void> {
    const pages = this.context.pages();
    if (pages.length > before) {
      const newest = pages[pages.length - 1];
      if (newest && newest !== this.page) {
        this.page = newest;
        await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
      }
    }
  }
  async actByIndex(idx: number, action: "click" | "type" | "select", text?: string): Promise<void> {
    const loc = await this.locByIndex(idx);
    if (!loc) throw new Error(`elemento [${idx}] não existe mais — leia o estado de novo (a página mudou)`);
    if (action === "type") return void (await loc.fill(text ?? "", { timeout: this.timeoutMs }));
    if (action === "select") return void (await loc.selectOption(text ?? "", { timeout: this.timeoutMs }));
    const before = this.context.pages().length;
    await loc.scrollIntoViewIfNeeded({ timeout: this.timeoutMs }).catch(() => {});
    await loc.click({ timeout: this.timeoutMs });
    await this.page.waitForTimeout(250).catch(() => {});
    await this.switchToNewTabIfAny(before);
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }
  async fillByIndex(idx: number, value: string): Promise<void> {
    const loc = await this.locByIndex(idx);
    if (!loc) throw new Error(`campo [${idx}] não existe mais — leia o estado de novo`);
    await loc.fill(value, { timeout: this.timeoutMs });
  }
  async clickXY(x: number, y: number): Promise<void> {
    const before = this.context.pages().length;
    await this.page.mouse.click(x, y);
    await this.page.waitForTimeout(200).catch(() => {});
    await this.switchToNewTabIfAny(before);
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }
  async dragXY(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    await this.page.mouse.move(x1, y1);
    await this.page.mouse.down();
    await this.page.mouse.move(x2, y2, { steps: 8 });
    await this.page.mouse.up();
  }
  async scroll(down: boolean, pages: number): Promise<void> {
    await this.page.mouse.wheel(0, (down ? 1 : -1) * Math.max(0.2, pages) * 900).catch(() => {});
    await this.page.waitForTimeout(300).catch(() => {});
  }
  async sendKeys(keys: string): Promise<void> {
    await this.page.keyboard.press(keys, { timeout: this.timeoutMs }).catch(() => {});
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }
  /** desafio "aperte e segure" NÃO é resolvido automaticamente neste fluxo (fora de escopo). */
  async pressAndHold(): Promise<void> {
    throw new Error("desafio anti-bot ('aperte e segure') não é resolvido automaticamente — use handoff(reason) e deixe o humano resolver na janela");
  }
  async close(): Promise<void> {
    // conectamos por CDP a um navegador que pode ficar aberto p/ a próxima tarefa: não fecha.
  }
}

/** Abre (ou conecta a) o navegador real num perfil dedicado via CDP, sem stealth. */
export async function openCdpBrowser(opts: CdpBrowserOptions = {}): Promise<BrowserSession> {
  const port = opts.port ?? Number(process.env.TYPER_CDP_PORT ?? 9222);
  const profile = expandHome(opts.profileDir ?? defaultCdpProfile());
  if (isPersonalProfile(profile)) throw new Error(`perfil ${profile} é o seu navegador pessoal — use um perfil dedicado (TYPER_BROWSER_PROFILE)`);
  const timeoutMs = opts.timeoutMs ?? 18_000;
  let ws = await cdpAlive(port);
  if (!ws) {
    if (opts.connectOnly) throw new Error(`nada escutando em CDP :${port}`);
    const exe = opts.executablePath ?? findMacBrowser();
    if (!exe) throw new Error("nenhum navegador real encontrado (instale Brave ou Chrome, ou defina TYPER_BROWSER_PATH)");
    await launchBrowser(exe, profile, port);
    ws = await cdpAlive(port);
  }
  const chromium = await loadChromium();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout?.(timeoutMs);
  return new CdpSession(context, page, timeoutMs);
}
