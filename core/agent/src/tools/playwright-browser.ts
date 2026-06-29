// core/agent/tools/playwright-browser.ts
// BrowserSession sobre Playwright (Chromium), com foco em ANTI-BOT (prioridade do dono):
//   - stealth sempre: remove a flag navigator.webdriver e o "--enable-automation".
//   - channel:"chrome": usa o Google Chrome INSTALADO (fingerprint real), não o chromium pelado.
//   - cdpUrl: CONECTA a um Chrome que o usuário já abriu (--remote-debugging-port) → dirige o
//     navegador REAL da máquina, com cookies/histórico/fingerprint dele (o mais difícil de detectar).
//   - user-agent realista (esconde o "HeadlessChrome").
// Playwright é carregado em runtime (import por variável) p/ o build não exigir o pacote.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserSession } from "./types.js";

export interface BrowserOptions {
  /** dir do perfil persistente (cookies). Default ~/.typer/browser/profile */
  profileDir?: string;
  /** headless (24/7) ou headful (janela visível). Default headless. Headful é melhor p/ anti-bot. */
  headless?: boolean;
  /** timeout de navegação por ação (ms). Default 30s. */
  timeoutMs?: number;
  /** "chrome" usa o Google Chrome instalado (anti-bot melhor que o chromium pelado). */
  channel?: string;
  /** caminho do binário do navegador (Brave/Chrome/Edge). Default: auto-detecta o instalado. */
  executablePath?: string;
  /** conecta a um Chrome/Brave JÁ ABERTO via CDP (ex.: http://127.0.0.1:9222) → navegador REAL. */
  cdpUrl?: string;
  /** user-agent (esconde o "HeadlessChrome"). Default: Chrome estável recente. */
  userAgent?: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-default-browser-check",
  "--no-first-run",
];

function defaultProfile(): string {
  return process.env.TYPER_BROWSER_PROFILE ?? join(homedir(), ".typer", "browser", "profile");
}

/** Caminhos comuns de navegadores REAIS (anti-bot melhor que o chromium pelado). Ordem
 *  de preferência: Brave → Chrome → Edge → Chromium. Cobre Linux e macOS. */
const REAL_BROWSERS: string[] = [
  "/usr/bin/brave-browser",
  "/opt/brave.com/brave/brave",
  "/snap/bin/brave",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/microsoft-edge",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Acha o 1º navegador real instalado (ou o override por env). undefined → chromium do Playwright. */
function findRealBrowser(): string | undefined {
  const env = process.env.TYPER_BROWSER_PATH;
  if (env && existsSync(env)) return env;
  return REAL_BROWSERS.find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Init script de stealth — esconde os sinais óbvios de automação. */
async function applyStealth(page: any): Promise<void> {
  await page
    .addInitScript(() => {
      // navigator.webdriver = undefined (o tell nº1 de bot)
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // plugins/idiomas plausíveis
      Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    })
    .catch(() => {});
}

class PlaywrightSession implements BrowserSession {
  constructor(
    private readonly context: any,
    private readonly page: any,
    private readonly timeoutMs: number,
    /** true = nós lançamos (fechar no close); false = conectamos a um Chrome do usuário (não fechar). */
    private readonly owned: boolean,
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
    // se conectamos ao Chrome do usuário, NÃO fechamos o navegador dele.
    if (this.owned) await this.context.close().catch(() => {});
  }
}

async function loadChromium(): Promise<any> {
  try {
    const spec = "playwright";
    const pw: any = await import(spec);
    const chromium = pw.chromium ?? pw.default?.chromium;
    if (!chromium) throw new Error("sem chromium");
    return chromium;
  } catch {
    throw new Error(
      "playwright não instalado — rode: pnpm -w add playwright && npx playwright install chromium",
    );
  }
}

/** Abre um navegador p/ o agente. Prioriza anti-bot: conecta ao Chrome real (cdpUrl) se dado;
 *  senão lança o Chrome instalado (channel) ou o chromium, sempre com stealth. */
export async function openBrowser(opts: BrowserOptions = {}): Promise<BrowserSession> {
  const chromium = await loadChromium();
  const timeoutMs = opts.timeoutMs ?? 30_000;

  // (1) Conectar ao Chrome JÁ ABERTO do usuário (melhor anti-bot: navegador real da máquina).
  if (opts.cdpUrl) {
    const browser = await chromium.connectOverCDP(opts.cdpUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout?.(timeoutMs);
    await applyStealth(page);
    return new PlaywrightSession(context, page, timeoutMs, false);
  }

  // (2) Lançar perfil persistente — usando o navegador REAL instalado (Brave/Chrome), sempre
  //     com stealth. Auto-detecta se nada for passado (channel/executablePath/cdpUrl).
  const executablePath = opts.executablePath ?? (opts.channel ? undefined : findRealBrowser());
  const context = await chromium.launchPersistentContext(opts.profileDir ?? defaultProfile(), {
    headless: opts.headless ?? true,
    ...(opts.channel ? { channel: opts.channel } : {}),
    ...(executablePath ? { executablePath } : {}),
    args: STEALTH_ARGS,
    userAgent: opts.userAgent ?? DEFAULT_UA,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout?.(timeoutMs);
  await applyStealth(page);
  return new PlaywrightSession(context, page, timeoutMs, true);
}
