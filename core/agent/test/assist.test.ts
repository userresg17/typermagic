// core/agent/test/assist.test.ts — a invariante de segurança central do projeto:
// vault_fill digita o segredo NA PÁGINA, mas o valor NUNCA volta pro modelo, pro
// resultado, nem pra auditoria. Mais ask_user (esclarecimento/OTP) e vault_fields.

import { describe, it, expect } from "vitest";
import {
  buildDefaultRegistry,
  dispatch,
  type ToolContext,
  type ToolDeps,
  type BrowserSession,
  type AuditEvent,
} from "../src/index.js";

const SECRET = "4111111111111234";

class FakeBrowser implements BrowserSession {
  readonly filled: Array<{ selector: string; value: string }> = [];
  async goto(): Promise<void> {}
  async text(): Promise<string> {
    return "";
  }
  async click(): Promise<void> {}
  async fill(selector: string, value: string): Promise<void> {
    this.filled.push({ selector, value });
  }
  async select(): Promise<void> {}
  async screenshot(): Promise<string> {
    return "";
  }
  async url(): Promise<string> {
    return "https://x";
  }
  async submit(): Promise<void> {}
  async close(): Promise<void> {}
}

class FakeVault {
  private readonly store: Record<string, string> = { card_number: SECRET, address: "Rua X, 100" };
  get(f: string): string | undefined {
    return this.store[f];
  }
  has(f: string): boolean {
    return f in this.store;
  }
  fields(): string[] {
    return Object.keys(this.store);
  }
}

const registry = buildDefaultRegistry();

function ctxWith(deps: ToolDeps, audit: (e: AuditEvent) => void = () => {}): ToolContext {
  return {
    workspace: "/tmp",
    origin: "agent",
    approve: async () => true,
    audit,
    seal: { verify: async () => ({ passed: true }) },
    deps,
  };
}

describe("assist — segredo nunca toca o modelo/log (invariante central)", () => {
  it("vault_fill digita o segredo na página, mas NÃO o devolve nem audita o valor", async () => {
    const browser = new FakeBrowser();
    const audited: AuditEvent[] = [];
    const ctx = ctxWith({ browser, vault: new FakeVault() }, (e) => audited.push(e));

    const r = await dispatch(registry, "vault_fill", { field: "card_number", selector: "#card" }, ctx);
    expect(r.ok).toBe(true);

    // o segredo FOI digitado na página (efeito real)
    expect(browser.filled).toEqual([{ selector: "#card", value: SECRET }]);

    // ...mas NUNCA aparece no resultado, nos args auditados, nem em lugar nenhum visível
    const visible = JSON.stringify({ result: r, audited });
    expect(visible).not.toContain(SECRET);
    expect(visible).not.toContain("4111");
    expect((r.value as { filled_field: string }).filled_field).toBe("card_number");
  });

  it("vault_fields lista só NOMES (sem valores)", async () => {
    const ctx = ctxWith({ vault: new FakeVault() });
    const r = await dispatch(registry, "vault_fields", {}, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as { fields: string[] }).fields.sort()).toEqual(["address", "card_number"]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("vault_fill recusa campo ausente no cofre", async () => {
    const ctx = ctxWith({ vault: new FakeVault(), browser: new FakeBrowser() });
    const r = await dispatch(registry, "vault_fill", { field: "nao_existe", selector: "#x" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("no_field");
  });

  it("ask_user pergunta pelo canal e devolve a resposta (clarify/OTP)", async () => {
    let asked = "";
    let kind = "";
    const ctx = ctxWith({
      ask: async (k, q) => {
        kind = k;
        asked = q;
        return "M";
      },
    });
    const r = await dispatch(registry, "ask_user", { question: "qual o tamanho?", kind: "clarify" }, ctx);
    expect(r.ok).toBe(true);
    expect((r.value as { answer: string }).answer).toBe("M");
    expect(asked).toBe("qual o tamanho?");
    expect(kind).toBe("clarify");
  });

  it("ask_user sem canal → ask_unavailable", async () => {
    const r = await dispatch(registry, "ask_user", { question: "x" }, ctxWith({}));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("ask_unavailable");
  });
});
