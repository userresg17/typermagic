// Testes do cliente JSON-RPC (framing por linha + correlação por id) — 5.6.
import { describe, it, expect } from "vitest";
import { JsonRpcEndpoint } from "../src/jsonrpc.js";

describe("JsonRpcEndpoint (5.6)", () => {
  it("envia request com jsonrpc/id/method e resolve pelo result correlato", async () => {
    const sent: string[] = [];
    const ep = new JsonRpcEndpoint((line) => sent.push(line));
    const p = ep.request<{ ok: boolean }>("ping", { x: 1 });
    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]!);
    expect(msg).toMatchObject({ jsonrpc: "2.0", id: 1, method: "ping", params: { x: 1 } });
    expect(sent[0]!.endsWith("\n")).toBe(true);
    // resposta chega
    ep.feed(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }) + "\n");
    await expect(p).resolves.toEqual({ ok: true });
    expect(ep.pendingCount).toBe(0);
  });

  it("correlaciona respostas fora de ordem por id", async () => {
    const sent: string[] = [];
    const ep = new JsonRpcEndpoint((l) => sent.push(l));
    const a = ep.request<number>("a");
    const b = ep.request<number>("b");
    // responde b antes de a
    ep.feed(JSON.stringify({ id: 2, result: 20 }) + "\n");
    ep.feed(JSON.stringify({ id: 1, result: 10 }) + "\n");
    await expect(a).resolves.toBe(10);
    await expect(b).resolves.toBe(20);
  });

  it("junta chunks parciais e processa múltiplas linhas num feed", async () => {
    const ep = new JsonRpcEndpoint(() => {});
    const p = ep.request("x");
    ep.feed('{"id":1,"resu'); // metade
    ep.feed('lt":42}\n{"id":99,"result":0}\n'); // resto + linha extra (id desconhecido)
    await expect(p).resolves.toBe(42);
  });

  it("rejeita quando a resposta traz error", async () => {
    const ep = new JsonRpcEndpoint(() => {});
    const p = ep.request("boom");
    ep.feed(JSON.stringify({ id: 1, error: { code: -32601, message: "method not found" } }) + "\n");
    await expect(p).rejects.toThrow(/method not found/);
  });

  it("notify não cria pendência e não tem id", () => {
    const sent: string[] = [];
    const ep = new JsonRpcEndpoint((l) => sent.push(l));
    ep.notify("notifications/initialized");
    const msg = JSON.parse(sent[0]!);
    expect(msg.method).toBe("notifications/initialized");
    expect(msg.id).toBeUndefined();
    expect(ep.pendingCount).toBe(0);
  });

  it("fail() rejeita todos os pendentes", async () => {
    const ep = new JsonRpcEndpoint(() => {});
    const p = ep.request("x");
    ep.fail(new Error("transporte caiu"));
    await expect(p).rejects.toThrow(/transporte caiu/);
    expect(ep.pendingCount).toBe(0);
  });

  it("ignora linhas inválidas (logs do servidor) sem quebrar", async () => {
    const ep = new JsonRpcEndpoint(() => {});
    const p = ep.request("x");
    ep.feed("isto não é json\n");
    ep.feed(JSON.stringify({ id: 1, result: "ok" }) + "\n");
    await expect(p).resolves.toBe("ok");
  });
});

describe("JsonRpcEndpoint bidirecional (Fase 0a)", () => {
  it("onNotify recebe notificações de entrada (sem id)", () => {
    const seen: Array<[string, unknown]> = [];
    const ep = new JsonRpcEndpoint(() => {}, {
      onNotify: (m, p) => seen.push([m, p]),
    });
    ep.feed(JSON.stringify({ jsonrpc: "2.0", method: "chat.chunk", params: { text: "oi" } }) + "\n");
    expect(seen).toEqual([["chat.chunk", { text: "oi" }]]);
  });

  it("onRequest responde o result correlacionado por id", async () => {
    const sent: string[] = [];
    const ep = new JsonRpcEndpoint((l) => sent.push(l), {
      onRequest: (m, p) => ({ echoed: m, got: p }),
    });
    ep.feed(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping", params: { a: 1 } }) + "\n");
    await Promise.resolve(); // deixa o handler async resolver
    await new Promise((r) => setTimeout(r, 0));
    const resp = JSON.parse(sent[0]!);
    expect(resp).toMatchObject({ jsonrpc: "2.0", id: 7, result: { echoed: "ping", got: { a: 1 } } });
  });

  it("onRequest que lança vira resposta de erro", async () => {
    const sent: string[] = [];
    const ep = new JsonRpcEndpoint((l) => sent.push(l), {
      onRequest: () => {
        throw new Error("falhou no handler");
      },
    });
    ep.feed(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "boom" }) + "\n");
    await new Promise((r) => setTimeout(r, 0));
    const resp = JSON.parse(sent[0]!);
    expect(resp.id).toBe(3);
    expect(resp.error.message).toMatch(/falhou no handler/);
  });

  it("sem handlers, requests/notifs de entrada são ignorados (cliente-só intacto)", () => {
    const sent: string[] = [];
    const ep = new JsonRpcEndpoint((l) => sent.push(l));
    ep.feed(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
    ep.feed(JSON.stringify({ jsonrpc: "2.0", method: "note" }) + "\n");
    expect(sent).toHaveLength(0); // não responde nada
  });

  it("dois endpoints ligados: request/response + notificação ponta-a-ponta", async () => {
    // a ↔ b: o send de um alimenta o feed do outro (closures rodam em runtime)
    const notifs: unknown[] = [];
    const a = new JsonRpcEndpoint((l) => b.feed(l), {
      onNotify: (_m, p) => notifs.push(p),
    });
    const b = new JsonRpcEndpoint((l) => a.feed(l), {
      onRequest: async (m, p) => {
        if (m === "soma") {
          const { x, y } = p as { x: number; y: number };
          b.notify("progresso", { etapa: "somando" }); // server → cliente (a)
          return x + y;
        }
        return null;
      },
    });
    const res = await a.request<number>("soma", { x: 2, y: 3 });
    expect(res).toBe(5);
    expect(notifs).toEqual([{ etapa: "somando" }]);
  });
});
