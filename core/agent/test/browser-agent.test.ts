import { describe, it, expect } from "vitest";
import { runBrowserAgent } from "../src/browser/agent.js";
import { serializeState } from "../src/browser/dom.js";
import type { BrowserSession, PageState } from "../src/tools/types.js";

function fakeSession(states: PageState[]): { session: BrowserSession; acts: string[] } {
  const acts: string[] = [];
  let sc = 0;
  const session = {
    async state() {
      return states[Math.min(sc++, states.length - 1)]!;
    },
    async actByIndex(idx: number, action: string, text?: string) {
      acts.push(`${action}[${idx}]${text ? "=" + text : ""}`);
    },
    async fillByIndex(idx: number) {
      acts.push(`fill[${idx}]`);
    },
    async goto(u: string) {
      acts.push(`goto ${u}`);
    },
    async scroll() {},
    async sendKeys() {},
    async pressAndHold(idx: number, ms: number) {
      acts.push(`hold[${idx}]:${ms}`);
    },
    async text() {
      return "";
    },
    async click() {},
    async fill() {},
    async select() {},
    async screenshot() {
      return "";
    },
    async screenshotMarked() {
      return "";
    },
    async url() {
      return "";
    },
    async submit() {},
    async close() {},
  } as unknown as BrowserSession;
  return { session, acts };
}

describe("browser dom serializer", () => {
  it("numera elementos no formato [idx]<tag> texto", () => {
    const s = serializeState({
      url: "https://x.com",
      title: "Loja",
      text: "Bem-vindo",
      elements: [
        { idx: 0, tag: "input", type: "text", text: "Buscar" },
        { idx: 1, tag: "button", text: "Entrar" },
      ],
    });
    expect(s).toContain("[0]<input type=text> Buscar");
    expect(s).toContain("[1]<button> Entrar");
    expect(s).toContain("URL: https://x.com");
  });
});

describe("browser sub-agente (loop perceber→agir)", () => {
  it("age por ÍNDICE e termina no done", async () => {
    const states: PageState[] = [
      {
        url: "https://shop",
        title: "",
        text: "",
        elements: [
          { idx: 0, tag: "input", text: "user", type: "text" },
          { idx: 1, tag: "button", text: "Login" },
        ],
      },
      { url: "https://shop/in", title: "", text: "", elements: [{ idx: 0, tag: "button", text: "Comprar" }] },
    ];
    const { session, acts } = fakeSession(states);
    const scripts = [
      '{"actions":[{"action":"input","index":0,"text":"joao"},{"action":"click","index":1}]}',
      '{"actions":[{"action":"done","text":"Pronto: logado.","success":true}]}',
    ];
    let n = 0;
    const out = await runBrowserAgent("logar", {
      session,
      llm: async () => scripts[n++] ?? '{"actions":[{"action":"done","text":"fim"}]}',
      maxSteps: 5,
    });
    expect(out).toContain("Pronto");
    expect(acts).toContain("type[0]=joao");
    expect(acts).toContain("click[1]");
  });

  it("press_hold aciona o mouse real (aperte e segure, anti-bot do iFood)", async () => {
    const states: PageState[] = [{ url: "https://ifood", title: "", text: "", elements: [{ idx: 0, tag: "button", text: "Aperte e segure" }] }];
    const { session, acts } = fakeSession(states);
    const scripts = [
      '{"actions":[{"action":"press_hold","index":0,"seconds":5}]}',
      '{"actions":[{"action":"done","text":"passei no desafio"}]}',
    ];
    let n = 0;
    const out = await runBrowserAgent("passar no aperte e segure", {
      session,
      llm: async () => scripts[n++] ?? '{"actions":[{"action":"done","text":"fim"}]}',
      maxSteps: 4,
    });
    expect(acts).toContain("hold[0]:5000");
    expect(out).toContain("passei");
  });

  it("finalize PEDE aprovação humana (HITL) e só então clica", async () => {
    const states: PageState[] = [{ url: "https://pay", title: "", text: "", elements: [{ idx: 3, tag: "button", text: "Pagar" }] }];
    const { session, acts } = fakeSession(states);
    const scripts = [
      '{"actions":[{"action":"finalize","index":3,"summary":"pagar R$10 no cartão final 4242"}]}',
      '{"actions":[{"action":"done","text":"pago","success":true}]}',
    ];
    let n = 0;
    const approvals: string[] = [];
    const out = await runBrowserAgent("pagar", {
      session,
      llm: async () => scripts[n++] ?? '{"actions":[{"action":"done","text":"fim"}]}',
      approve: async (r) => {
        approvals.push(r);
        return true;
      },
      maxSteps: 5,
    });
    expect(approvals[0]).toContain("pagar R$10");
    expect(acts).toContain("click[3]");
    expect(out).toContain("pago");
  });

  it("CLIQUE direto num botão irreversível também exige aprovação (sem bypass)", async () => {
    const states: PageState[] = [{ url: "https://pay", title: "", text: "", elements: [{ idx: 0, tag: "button", text: "Finalizar compra" }] }];
    const { session, acts } = fakeSession(states);
    // o modelo tenta CLICAR direto no botão de pagar (driblando o finalize)
    const scripts = [
      '{"actions":[{"action":"click","index":0}]}',
      '{"actions":[{"action":"click","index":0}]}',
      '{"actions":[{"action":"done","text":"parei"}]}',
    ];
    let n = 0;
    const approvals: string[] = [];
    const out = await runBrowserAgent("comprar", {
      session,
      llm: async () => scripts[n++] ?? '{"actions":[{"action":"done","text":"fim"}]}',
      approve: async (r) => {
        approvals.push(r);
        return false;
      },
      maxSteps: 6,
    });
    expect(approvals.length).toBeGreaterThanOrEqual(1); // o clique no botão de pagar PEDIU aprovação
    expect(acts).not.toContain("click[0]"); // negado → NÃO clicou
    expect(out).toContain("não confirmou");
  });

  it("PUBLICAR em rede social exige aprovação (post é irreversível/público)", async () => {
    const states: PageState[] = [{ url: "https://x.com", title: "", text: "", elements: [{ idx: 5, tag: "button", text: "Postar" }] }];
    const { session, acts } = fakeSession(states);
    const scripts = [
      '{"actions":[{"action":"click","index":5}]}',
      '{"actions":[{"action":"click","index":5}]}',
      '{"actions":[{"action":"done","text":"não postei"}]}',
    ];
    let n = 0;
    const approvals: string[] = [];
    const out = await runBrowserAgent("postar no X", {
      session,
      llm: async () => scripts[n++] ?? '{"actions":[{"action":"done","text":"fim"}]}',
      approve: async (r) => {
        approvals.push(r);
        return false;
      },
      maxSteps: 6,
    });
    expect(approvals.length).toBeGreaterThanOrEqual(1);
    expect(acts).not.toContain("click[5]");
    expect(out).toContain("não confirmou");
  });

  it("finalize NEGADO não clica", async () => {
    const states: PageState[] = [{ url: "https://pay", title: "", text: "", elements: [{ idx: 2, tag: "button", text: "Pagar" }] }];
    const { session, acts } = fakeSession(states);
    const scripts = [
      '{"actions":[{"action":"finalize","index":2,"summary":"pagar"}]}',
      '{"actions":[{"action":"done","text":"não paguei","success":false}]}',
    ];
    let n = 0;
    const out = await runBrowserAgent("pagar", {
      session,
      llm: async () => scripts[n++] ?? '{"actions":[{"action":"done","text":"fim"}]}',
      approve: async () => false,
      maxSteps: 5,
    });
    expect(acts).not.toContain("click[2]");
    expect(out).toContain("não paguei");
  });
});
