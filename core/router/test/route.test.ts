import { describe, it, expect } from "vitest";
import { pickModel, route, DEFAULT_POLICY } from "../src/route.js";
import type { RoutingPolicy } from "../src/route.js";
import { FakeProvider } from "../src/fake-provider.js";

describe("pickModel", () => {
  it("manda autocomplete para o modelo rápido", () => {
    expect(pickModel("autocomplete")).toBe("claude-haiku-4-5");
  });

  it("manda agent e chat para o modelo forte", () => {
    expect(pickModel("agent")).toBe("claude-opus-4-8");
    expect(pickModel("chat")).toBe("claude-opus-4-8");
  });

  it("respeita o override do usuário", () => {
    expect(pickModel("chat", "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("respeita uma política customizada", () => {
    const policy: RoutingPolicy = {
      ...DEFAULT_POLICY,
      models: { ...DEFAULT_POLICY.models, chat: "modelo-x" },
    };
    expect(pickModel("chat", undefined, policy)).toBe("modelo-x");
  });
});

describe("route", () => {
  const fake = new FakeProvider();

  it("escolhe o provider preferido quando registrado", () => {
    const p = route("chat", { fake }, "fake");
    expect(p.id).toBe("fake");
  });

  it("cai no primeiro disponível quando o preferido não existe", () => {
    const p = route("chat", { fake }, "anthropic");
    expect(p.id).toBe("fake");
  });

  it("usa o provider da política por tarefa quando não há override", () => {
    const policy: RoutingPolicy = {
      ...DEFAULT_POLICY,
      providers: { chat: "fake" },
      defaultProvider: "inexistente",
    };
    const p = route("chat", { fake }, undefined, policy);
    expect(p.id).toBe("fake");
  });

  it("estoura quando nenhum provider está registrado", () => {
    expect(() => route("chat", {})).toThrow(/Nenhum provider/);
  });
});
