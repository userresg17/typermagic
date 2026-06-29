// core/agent/tools/playwright-browser.ts
// Implementação real de BrowserSession sobre Playwright (Chromium), com PERFIL PERSISTENTE
// e ISOLADO (~/.typer/browser/profile) — assim cookies (ex.: Gmail logado) ficam separados
// do navegador do usuário. Playwright é carregado em RUNTIME (import por variável) p/ que o
// build não exija o pacote; ausência → erro claro de instalação. Headless por padrão (24/7);
// headful opcional (PARA o relay humano de CAPTCHA: a janela fica visível pro usuário).

import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserSession } from "./types.js";

export interface BrowserOptions {
  /** dir do perfil persistente (cookies). Default ~/.typer/browser/profile */
  profileDir?: string;
  /** headless (24/7) ou headful (janela visível, p/ relay de CAPTCHA). Default headless. */
  headless?: boolean;
  /** timeout de navegação por ação (ms). Default 30s. */
  timeoutMs?: number;
}

function defaultProfile(): string {
  return process.env.TYPER_BROWSER_PROFILE ?? join(homedir(), ".typer", "browser", "profile");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class PlaywrightSession implements BrowserSession {
  constructor(
    private readonly context: any,
    private readonly page: any,
    private readonly timeoutMs: number,
  ) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
  }
  async text(): Promise<string> {
    const t: string = await this.page.innerText("body").catch(() => "");
    return t.replace(/\n{3,}/g, "\n\n").slice(0, 15_000);
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
  async url(): Promise<string> {
    return this.page.url();
  }
  async submit(selector: string): Promise<void> {
    await Promise.all([
      this.page.waitForLoadState("networkidle", { timeout: this.timeoutMs }).catch(() => {}),
      this.page.click(selector, { timeout: this.timeoutMs }),
    ]);
  }
  async close(): Promise<void> {
    await this.context.close().catch(() => {});
  }
}

/** Abre um navegador Playwright com perfil isolado. Lança erro claro se playwright ausente. */
export async function openBrowser(opts: BrowserOptions = {}): Promise<BrowserSession> {
  let pw: any;
  try {
    const spec = "playwright";
    pw = await import(spec);
  } catch {
    throw new Error(
      "playwright não instalado — rode: pnpm -w add playwright && npx playwright install chromium",
    );
  }
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright sem chromium — rode: npx playwright install chromium");
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const context = await chromium.launchPersistentContext(opts.profileDir ?? defaultProfile(), {
    headless: opts.headless ?? true,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout?.(timeoutMs);
  return new PlaywrightSession(context, page, timeoutMs);
}
