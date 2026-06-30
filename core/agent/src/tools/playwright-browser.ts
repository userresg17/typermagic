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
import type { BrowserSession, InteractiveElement, PageState } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Roda DENTRO da página (cada frame): acha os elementos interativos VISÍVEIS, marca cada um
 *  com data-typer-idx = offset+i (índice global), e devolve a lista numerada. É a "leitura da
 *  tela" — o modelo age pelo índice, não por seletor CSS frágil. */
const EXTRACT_FN = (offset: number): unknown[] => {
  const g = globalThis as any;
  const doc = g.document;
  if (!doc) return [];
  const SEL =
    "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=textbox],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[onclick],summary,[contenteditable=true]";
  const isVis = (el: any): boolean => {
    const r = el.getBoundingClientRect();
    const s = g.getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  // Deep-walk: percorre o DOM DESCENDO em shadow roots. Sites modernos (Reddit, muitos web
  // components) põem os campos de login/form dentro de Shadow DOM; sem isso os inputs "somem"
  // (querySelectorAll não atravessa shadow). O Playwright atravessa shadow no clique, então
  // basta acharmos e marcarmos com data-typer-idx aqui.
  const all: any[] = [];
  const walk = (root: any): void => {
    let nodes: any[];
    try {
      nodes = Array.from(root.querySelectorAll("*")) as any[];
    } catch {
      return;
    }
    for (const el of nodes) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot); // desce no shadow DOM aberto
    }
  };
  walk(doc);

  const set = new Set<any>();
  // 1) interativos por seletor (inclui os que estão dentro de shadow roots)
  for (const el of all) {
    try {
      if (el.matches && el.matches(SEL)) set.add(el);
    } catch {
      /* ignora */
    }
  }
  // 2) clicáveis "custom" (cursor:pointer) — pega CARDS de hotel/produto que são <div> com
  //    handler JS. Limitado a tags-container e a páginas não-gigantes (custo do getComputedStyle).
  const CURSOR_TAGS = new Set(["DIV", "SPAN", "LI", "ARTICLE", "SECTION", "TD", "TH", "LABEL", "IMG", "P", "H1", "H2", "H3", "A"]);
  if (all.length <= 3500) {
    for (const el of all) {
      if (set.has(el) || !CURSOR_TAGS.has(el.tagName)) continue;
      let st: any;
      try {
        st = g.getComputedStyle(el);
      } catch {
        continue;
      }
      if (st.cursor !== "pointer") continue;
      let p = el.parentElement;
      let dup = false;
      while (p) {
        if (set.has(p)) {
          dup = true;
          break;
        }
        p = p.parentElement;
      }
      if (!dup) set.add(el);
    }
  }
  const els = Array.from(set).filter(isVis).slice(0, 150); // teto p/ não estourar o contexto
  return els.map((el: any, i: number) => {
    const idx = offset + i;
    el.setAttribute("data-typer-idx", String(idx));
    const label = String(
      el.getAttribute("aria-label") ||
        el.innerText ||
        el.value ||
        el.placeholder ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.getAttribute("alt") ||
        "",
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 90);
    const isInput = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
    return {
      idx,
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      role: el.getAttribute("role") || "",
      text: label,
      value: isInput ? String(el.value || "").slice(0, 40) : "",
    };
  });
};

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
    private page: any, // mutável: trocamos p/ a nova aba quando um clique abre uma (sites de hotel)
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
    // clica e espera a página assentar — "domcontentloaded" (NÃO "networkidle", que nunca
    // termina em sites com anúncios/polling e travava 30s toda vez).
    await this.page.click(selector, { timeout: this.timeoutMs }).catch(() => {});
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }

  /** LÊ A TELA: percorre todos os frames, numera os elementos interativos e devolve o estado. */
  async state(): Promise<PageState> {
    const url = this.page.url();
    const title = await this.page.title().catch(() => "");
    const text = await this.text();
    const elements: InteractiveElement[] = [];
    for (const frame of this.page.frames()) {
      try {
        const part = (await frame.evaluate(EXTRACT_FN, elements.length)) as InteractiveElement[];
        for (const e of part) elements.push(e);
      } catch {
        /* frame cross-origin/destruído: ignora */
      }
    }
    return { url, title, text, elements };
  }

  /** Acha o locator do elemento marcado com data-typer-idx=idx (em qualquer frame). */
  private async locByIndex(idx: number): Promise<any | null> {
    const sel = `[data-typer-idx="${idx}"]`;
    for (const frame of this.page.frames()) {
      const loc = frame.locator(sel);
      if (await loc.count().catch(() => 0)) return loc.first();
    }
    return null;
  }

  async actByIndex(idx: number, action: "click" | "type" | "select", text?: string): Promise<void> {
    const loc = await this.locByIndex(idx);
    if (!loc) throw new Error(`elemento [${idx}] não existe mais — leia o estado de novo (a página mudou)`);
    if (action === "type") {
      await loc.fill(text ?? "", { timeout: this.timeoutMs });
      return;
    }
    if (action === "select") {
      await loc.selectOption(text ?? "", { timeout: this.timeoutMs });
      return;
    }
    // clique: pode abrir NOVA ABA (sites de hotel abrem o quarto numa aba nova). Detecta e troca.
    const before = this.context.pages().length;
    await loc.scrollIntoViewIfNeeded({ timeout: this.timeoutMs }).catch(() => {});
    await loc.click({ timeout: this.timeoutMs });
    await this.page.waitForTimeout(250).catch(() => {});
    await this.switchToNewTabIfAny(before);
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }

  /** Se um clique abriu uma aba nova, passa a operar nela (e fecha as antigas órfãs? não —
   *  mantém; mas o foco vai pra mais nova, que é a página do hotel/produto). */
  private async switchToNewTabIfAny(beforeCount: number): Promise<void> {
    const pages = this.context.pages();
    if (pages.length > beforeCount) {
      const newest = pages[pages.length - 1];
      if (newest && newest !== this.page) {
        this.page = newest;
        await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
      }
    }
  }

  async fillByIndex(idx: number, value: string): Promise<void> {
    const loc = await this.locByIndex(idx);
    if (!loc) throw new Error(`campo [${idx}] não existe mais — leia o estado de novo`);
    await loc.fill(value, { timeout: this.timeoutMs });
  }

  async scroll(down: boolean, pages: number): Promise<void> {
    const dy = (down ? 1 : -1) * Math.max(0.2, pages) * 900;
    await this.page.mouse.wheel(0, dy).catch(() => {});
    await this.page.waitForTimeout(300).catch(() => {});
  }

  async sendKeys(keys: string): Promise<void> {
    await this.page.keyboard.press(keys, { timeout: this.timeoutMs }).catch(() => {});
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
  }

  /** move o mouse até (tx,ty) de forma HUMANA: vários passos + leve jitter (não teleporta). */
  private async humanMoveTo(tx: number, ty: number): Promise<void> {
    const steps = 16 + Math.floor(Math.random() * 12);
    // 1-2 waypoints com desvio, p/ a trajetória não ser uma reta perfeita
    const wx = tx + (Math.random() * 80 - 40);
    const wy = ty + (Math.random() * 60 - 30);
    await this.page.mouse.move(wx, wy, { steps: Math.ceil(steps / 2) }).catch(() => {});
    await this.page.mouse.move(tx, ty, { steps: Math.ceil(steps / 2) }).catch(() => {});
  }

  async pressAndHold(idx: number, ms: number): Promise<void> {
    const loc = await this.locByIndex(idx);
    if (!loc) throw new Error(`elemento [${idx}] não existe mais — leia o estado de novo`);
    await loc.scrollIntoViewIfNeeded({ timeout: this.timeoutMs }).catch(() => {});
    const box = await loc.boundingBox();
    if (!box) throw new Error(`elemento [${idx}] sem área visível p/ pressionar`);
    const tx = box.x + box.width / 2;
    const ty = box.y + box.height / 2;
    const hold = Math.min(Math.max(ms, 500), 15_000); // 0,5s–15s
    await this.humanMoveTo(tx, ty);
    await this.page.mouse.down();
    // segura com micro-movimentos (humano não fica 100% imóvel) até completar o tempo
    const until = Date.now() + hold;
    while (Date.now() < until) {
      await this.page.mouse.move(tx + (Math.random() * 4 - 2), ty + (Math.random() * 4 - 2), { steps: 1 }).catch(() => {});
      await this.page.waitForTimeout(110 + Math.floor(Math.random() * 90)).catch(() => {});
    }
    await this.page.mouse.up();
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.timeoutMs }).catch(() => {});
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
  const timeoutMs = opts.timeoutMs ?? 18_000;

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
