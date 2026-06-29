// core/agent/test/browser.test.ts — família browser despachada contra uma sessão FAKE
// (sem Playwright real). Cobre: degradação sem browser, operação da sessão, validação de
// URL e a injeção da persona.

import { describe, it, expect } from "vitest";
import {
  buildDefaultRegistry,
  dispatch,
  browserSkillSection,
  type ToolContext,
  type BrowserSession,
} from "../src/index.js";

class FakeBrowser implements BrowserSession {
  readonly calls: string[] = [];
  private current = "https://start";
  async goto(url: string): Promise<void> {
    this.calls.push(`goto:${url}`);
    this.current = url;
  }
  async text(): Promise<string> {
    this.calls.push("text");
    return "conteúdo legível da página";
  }
  async click(s: string): Promise<void> {
    this.calls.push(`click:${s}`);
  }
  async fill(s: string, v: string): Promise<void> {
    this.calls.push(`fill:${s}=${v}`);
  }
  async select(s: string, v: string): Promise<void> {
    this.calls.push(`select:${s}=${v}`);
  }
  async screenshot(): Promise<string> {
    this.calls.push("shot");
    return "UE5HAAAA";
  }
  async url(): Promise<string> {
    return this.current;
  }
  async submit(s: string): Promise<void> {
    this.calls.push(`submit:${s}`);
    this.current = "https://done";
  }
  async close(): Promise<void> {}
}

const registry = buildDefaultRegistry();
function ctx(browser?: BrowserSession): ToolContext {
  return {
    workspace: "/tmp",
    origin: "agent",
    approve: async () => true,
    audit: () => {},
    seal: { verify: async () => ({ passed: true }) },
    deps: browser ? { browser } : {},
  };
}

describe("família browser", () => {
  it("sem ctx.deps.browser → browser_unavailable (gracioso, não lança)", async () => {
    const r = await dispatch(registry, "browser_goto", { url: "https://x.com" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("browser_unavailable");
  });

  it("goto → read → fill → submit operam a sessão na ordem", async () => {
    const b = new FakeBrowser();
    const c = ctx(b);
    expect((await dispatch(registry, "browser_goto", { url: "https://loja.com" }, c)).ok).toBe(true);
    const read = await dispatch(registry, "browser_read", {}, c);
    expect(read.ok).toBe(true);
    expect((read.value as { text: string }).text).toContain("conteúdo");
    expect((await dispatch(registry, "browser_fill", { selector: "#cidade", value: "POA" }, c)).ok).toBe(true);
    const sub = await dispatch(registry, "browser_submit", { selector: "#pay" }, c);
    expect(sub.ok).toBe(true);
    expect((sub.value as { url: string }).url).toBe("https://done");
    expect(b.calls).toEqual(["goto:https://loja.com", "text", "fill:#cidade=POA", "submit:#pay"]);
  });

  it("browser_goto valida http(s)", async () => {
    const r = await dispatch(registry, "browser_goto", { url: "ftp://x" }, ctx(new FakeBrowser()));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("bad_url");
  });

  it("browser_submit é IRREVERSÍVEL (effect.reversible:false → HITL no engine)", () => {
    const submit = registry.all().find((t) => t.name === "browser_submit");
    expect(submit?.effect).toMatchObject({ external: true, reversible: false, kind: "network" });
  });

  it("browserSkillSection injeta só quando há tool browser_*", () => {
    expect(browserSkillSection([{ name: "browser_goto" }])).toContain("Chromium real");
    expect(browserSkillSection([{ name: "reach_read" }])).toBe("");
  });
});
