// Fluxo macOS do sub-agente de navegador: handoff humano, finalize estruturado com guardas de
// checkout/gasto, prompt alternativo e kill switch.
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBrowserAgent } from "../src/browser/agent.js";
import { BROWSER_AGENT_PROMPT_MACOS } from "../src/browser/prompt-macos.js";
import type { BrowserSession, PageState } from "../src/tools/types.js";

function fakeSession(state: PageState): { session: BrowserSession; acts: string[] } {
  const acts: string[] = [];
  const session = {
    async state() {
      return state;
    },
    async actByIndex(idx: number, action: string) {
      acts.push(`${action}[${idx}]`);
    },
    async fillByIndex() {},
    async goto() {},
    async scroll() {},
    async clickXY() {},
    async dragXY() {},
    async sendKeys() {},
    async pressAndHold() {
      throw new Error("sem press_hold");
    },
    async text() {
      return "";
    },
    async click() {},
    async fill() {},
    async select() {},
    async screenshot() {
      return "QUJD";
    },
    async screenshotMarked() {
      return "QUJD";
    },
    async url() {
      return state.url;
    },
    async isAlive() {
      return true;
    },
    async submit() {},
    async close() {},
  } as BrowserSession;
  return { session, acts };
}

const checkout: PageState = {
  url: "https://www.loja.com.br/checkout",
  title: "Checkout",
  text: "Total R$ 250,00",
  elements: [{ idx: 0, tag: "button", text: "Pagar agora" }],
};
const script = (...plans: object[]) => {
  let i = 0;
  return async (sys: string) => {
    if (i === 0) expect(sys).toBe(BROWSER_AGENT_PROMPT_MACOS);
    return JSON.stringify(plans[Math.min(i++, plans.length - 1)]);
  };
};

beforeEach(() => {
  process.env.TYPER_STEP_LOG = join(mkdtempSync(join(tmpdir(), "typer-ba-")), "steps.jsonl");
  process.env.TYPER_STOP_FILE = join(mkdtempSync(join(tmpdir(), "typer-ba-")), "STOP");
  process.env.TYPER_SPEND_LEDGER = join(mkdtempSync(join(tmpdir(), "typer-ba-")), "spend.json");
  process.env.TYPER_CHECKOUT_ALLOW_HOSTS = "";
  process.env.TYPER_MAX_PER_TX = "0";
});

describe("browser agent — fluxo macOS", () => {
  it("handoff: pausa com screenshot; 'ok' continua, 'cancelar' encerra", async () => {
    const { session } = fakeSession(checkout);
    const seen: string[] = [];
    const out = await runBrowserAgent("x", {
      session,
      prompt: BROWSER_AGENT_PROMPT_MACOS,
      handoff: async (reason, png) => {
        seen.push(`${reason}|${png}`);
        return seen.length === 1 ? "ok" : "cancelar";
      },
      llm: script({ actions: [{ action: "handoff", reason: "captcha" }] }, { actions: [{ action: "handoff", reason: "login" }] }),
    });
    expect(seen).toEqual(["captcha|QUJD", "login|QUJD"]);
    expect(out).toMatch(/cancelada/);
  });

  it("finalize de pagamento fora da allowlist de checkout é bloqueado sem perguntar", async () => {
    const { session, acts } = fakeSession(checkout);
    let asked = false;
    const out = await runBrowserAgent("pague", {
      session,
      prompt: BROWSER_AGENT_PROMPT_MACOS,
      approve: async () => {
        asked = true;
        return true;
      },
      llm: script({ actions: [{ action: "finalize", index: 0, summary: "Pagar pedido", amount: "R$ 250,00" }] }, { actions: [{ action: "done", text: "parei" }] }),
    });
    expect(asked).toBe(false);
    expect(acts).toEqual([]);
    expect(out).toBe("parei");
  });

  it("host permitido mas acima do teto → bloqueado; dentro do teto → cartão estruturado e clique", async () => {
    process.env.TYPER_CHECKOUT_ALLOW_HOSTS = "loja.com.br";
    process.env.TYPER_MAX_PER_TX = "100";
    const { session, acts } = fakeSession(checkout);
    const cards: string[] = [];
    const out1 = await runBrowserAgent("pague", {
      session,
      prompt: BROWSER_AGENT_PROMPT_MACOS,
      approve: async (c) => {
        cards.push(c);
        return true;
      },
      llm: script({ actions: [{ action: "finalize", index: 0, summary: "Pagar", amount: "R$ 250,00" }] }, { actions: [{ action: "done", text: "x" }] }),
    });
    expect(out1).toBe("x");
    expect(cards).toEqual([]);
    process.env.TYPER_MAX_PER_TX = "500";
    const shots: string[] = [];
    const out2 = await runBrowserAgent("pague", {
      session,
      prompt: BROWSER_AGENT_PROMPT_MACOS,
      approve: async (c) => {
        cards.push(c);
        return true;
      },
      checkpoint: async (_p, cap) => {
        shots.push(cap);
      },
      llm: script(
        { actions: [{ action: "finalize", index: 0, summary: "Pagar tênis", amount: "R$ 250,00", recipient: "Loja X", address: "Rua A, 1" }] },
        { actions: [{ action: "done", text: "pago" }] },
      ),
    });
    expect(out2).toBe("pago");
    expect(acts).toEqual(["click[0]"]);
    expect(cards[0]).toContain("Valor: R$ 250,00");
    expect(cards[0]).toContain("Vendedor/destinatário: Loja X");
    expect(cards[0]).toContain("Endereço: Rua A, 1");
    expect(shots.some((s) => s.includes("antes de confirmar"))).toBe(true);
  });

  it("kill switch encerra antes de agir", async () => {
    const { session, acts } = fakeSession(checkout);
    const ac = new AbortController();
    ac.abort();
    const out = await runBrowserAgent("x", { session, signal: ac.signal, prompt: BROWSER_AGENT_PROMPT_MACOS, llm: script({ actions: [{ action: "click", index: 0 }] }) });
    expect(out).toMatch(/kill switch/);
    expect(acts).toEqual([]);
  });
});
