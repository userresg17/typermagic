import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDesktopAgent, serializeAx } from "../src/desktop/agent.js";
import type { DesktopSession, AxTree } from "../src/platform/types.js";

function fakePlatform(app = "TextEdit", tree?: AxTree): { p: DesktopSession; acts: string[] } {
  const acts: string[] = [];
  const t: AxTree = tree ?? {
    app: { name: app, pid: 1, bundle: "x" },
    nodes: [
      { id: 1, depth: 0, role: "Window", label: "Sem título", value: "", pos: [0, 0], size: [800, 600], actions: [], enabled: true },
      { id: 2, depth: 1, role: "TextArea", label: "", value: "", pos: [10, 40], size: [780, 500], actions: [], enabled: true },
      { id: 3, depth: 1, role: "Button", label: "Enviar", value: "", pos: [700, 560], size: [80, 30], actions: ["Press"], enabled: true },
    ],
    truncated: false,
  };
  const p: DesktopSession = {
    name: "macos",
    async screenshot() {
      return { png_base64: "QUJD", width: 1440, height: 900, scale: 2 };
    },
    async click(x, y) {
      acts.push(`click ${x},${y}`);
    },
    async double_click() {},
    async type(text) {
      acts.push(`type ${text}`);
    },
    async key(c) {
      acts.push(`key ${c}`);
    },
    async scroll() {},
    async drag() {},
    async mouse_move() {},
    async mouse_location() {
      return { x: 0, y: 0 };
    },
    async get_screen_size() {
      return { width: 1440, height: 900, scale: 2 };
    },
    async close() {},
    async frontmost_app() {
      return { name: app, pid: 1, bundle: "x" };
    },
    async ax_tree() {
      return t;
    },
    async ax_act(id, action) {
      acts.push(`ax ${id} ${action}`);
    },
    async open_app(n) {
      acts.push(`open ${n}`);
      app = n;
    },
    async focus_app(n) {
      acts.push(`focus ${n}`);
      app = n;
    },
  };
  return { p, acts };
}

const script = (...plans: object[]) => {
  let i = 0;
  return async () => JSON.stringify(plans[Math.min(i++, plans.length - 1)]);
};

beforeEach(() => {
  process.env.TYPER_ALLOWED_APPS = "TextEdit,Notes";
  process.env.TYPER_STEP_LOG = join(mkdtempSync(join(tmpdir(), "typer-da-")), "steps.jsonl");
  process.env.TYPER_STOP_FILE = join(mkdtempSync(join(tmpdir(), "typer-da-")), "STOP");
  process.env.TYPER_MAX_PER_TX = "0";
});

describe("desktop agent", () => {
  it("fluxo feliz: abre app, digita via AX, termina", async () => {
    const { p, acts } = fakePlatform();
    const out = await runDesktopAgent("escreva olá", {
      platform: p,
      llm: script(
        { actions: [{ action: "focus_app", name: "TextEdit" }] },
        { actions: [{ action: "ax_act", id: 2, value: "olá" }, { action: "done", text: "feito", success: true }] },
      ),
    });
    expect(out).toBe("feito");
    expect(acts).toEqual(["focus TextEdit", "ax 2 SetValue"]);
  });

  it("app fora da allowlist é bloqueado (open e foco)", async () => {
    const { p, acts } = fakePlatform("Terminal");
    const out = await runDesktopAgent("x", {
      platform: p,
      llm: script({ actions: [{ action: "open_app", name: "Terminal" }, { action: "type", text: "rm -rf" }, { action: "done", text: "ok" }] }),
    });
    expect(out).toBe("ok");
    expect(acts).toEqual([]); // nada executou
  });

  it("nó com rótulo irreversível exige confirmação; negado 2x encerra", async () => {
    const { p, acts } = fakePlatform();
    const asks: string[] = [];
    const out = await runDesktopAgent("enviar", {
      platform: p,
      approve: async (c) => {
        asks.push(c.action);
        return false;
      },
      llm: script({ actions: [{ action: "ax_act", id: 3 }] }, { actions: [{ action: "key", combo: "cmd+enter" }] }),
    });
    expect(asks).toHaveLength(2);
    expect(acts).toEqual([]);
    expect(out).toMatch(/não foi confirmada/);
  });

  it("finalize aprovado libera UMA ação irreversível e manda checkpoint", async () => {
    const { p, acts } = fakePlatform();
    const shots: string[] = [];
    const out = await runDesktopAgent("enviar", {
      platform: p,
      approve: async () => true,
      checkpoint: async (_png, cap) => {
        shots.push(cap);
      },
      llm: script(
        { actions: [{ action: "finalize", summary: "Enviar e-mail p/ Ana", recipient: "ana@x.com" }] },
        { actions: [{ action: "ax_act", id: 3 }] },
        { actions: [{ action: "done", text: "enviado" }] },
      ),
    });
    expect(out).toBe("enviado");
    expect(acts).toEqual(["ax 3 Press"]);
    expect(shots.some((s) => s.includes("antes de confirmar"))).toBe(true);
    expect(shots.some((s) => s.includes("estado final"))).toBe(true);
  });

  it("finalize com valor acima do teto é bloqueado antes de perguntar", async () => {
    process.env.TYPER_MAX_PER_TX = "100";
    const { p } = fakePlatform();
    let asked = false;
    const out = await runDesktopAgent("pagar", {
      platform: p,
      approve: async () => {
        asked = true;
        return true;
      },
      llm: script({ actions: [{ action: "finalize", summary: "pagar", amount: "R$ 250,00" }] }, { actions: [{ action: "done", text: "fim" }] }),
    });
    expect(asked).toBe(false);
    expect(out).toBe("fim");
  });

  it("handoff cancelado encerra; kill switch para antes de agir", async () => {
    const { p, acts } = fakePlatform();
    const out = await runDesktopAgent("x", {
      platform: p,
      handoff: async () => "cancelar",
      llm: script({ actions: [{ action: "handoff", reason: "captcha" }] }),
    });
    expect(out).toMatch(/cancelada/);
    const ac = new AbortController();
    ac.abort();
    const out2 = await runDesktopAgent("x", { platform: p, signal: ac.signal, llm: script({ actions: [{ action: "type", text: "a" }] }) });
    expect(out2).toMatch(/kill switch/);
    expect(acts).toEqual([]);
  });

  it("serializeAx lista nós numerados com posição e ações", () => {
    const { p } = fakePlatform();
    void p;
    const txt = serializeAx({
      app: { name: "A", pid: 1, bundle: "" },
      nodes: [{ id: 7, depth: 1, role: "Button", label: "OK", value: "", pos: [1, 2], size: [3, 4], actions: ["Press"], enabled: true }],
      truncated: false,
    });
    expect(txt).toContain('[7] Button "OK" @1,2 {Press}');
  });
});
