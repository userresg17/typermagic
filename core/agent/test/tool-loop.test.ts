// Testes do loop de tool-use (5.6 execução) com FakeProvider.
import { describe, it, expect, vi } from "vitest";
import { FakeProvider } from "@typer/router";
import type { ToolSpec } from "@typer/router";
import { runToolLoop, type ToolExecutor } from "../src/tool-loop.js";

function executor(spy?: (n: string, a: unknown) => void): ToolExecutor {
  const specs: ToolSpec[] = [
    { name: "echo", description: "ecoa", inputSchema: { type: "object" } },
  ];
  return {
    tools: () => specs,
    call: async (name, args) => {
      spy?.(name, args);
      return { content: `resultado de ${name}(${JSON.stringify(args)})` };
    },
  };
}

describe("runToolLoop (5.6 execução)", () => {
  it("executa a ferramenta pedida e responde no turno seguinte", async () => {
    const callSpy = vi.fn();
    const res = await runToolLoop("faça X", {
      provider: new FakeProvider(),
      model: "fake",
      executor: executor(callSpy),
    });
    expect(res.turns).toBe(2); // turno 1 pede a tool; turno 2 responde
    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]!.name).toBe("echo");
    expect(callSpy).toHaveBeenCalledOnce();
    // o texto final ecoa o resultado da ferramenta
    expect(res.text).toContain("eco:");
    expect(res.text).toContain("resultado de echo");
  });

  it("sem ferramentas, responde em 1 turno (sem tool-use)", async () => {
    const empty: ToolExecutor = { tools: () => [], call: async () => ({ content: "" }) };
    const res = await runToolLoop("oi", {
      provider: new FakeProvider(),
      model: "fake",
      executor: empty,
    });
    expect(res.turns).toBe(1);
    expect(res.calls).toHaveLength(0);
    expect(res.text).toContain("eco: oi");
  });

  it("onToolCall recebe a chamada e o resultado", async () => {
    const seen: string[] = [];
    await runToolLoop("faça Y", {
      provider: new FakeProvider(),
      model: "fake",
      executor: executor(),
      onToolCall: (call, result) => seen.push(`${call.name}:${result.slice(0, 12)}`),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^echo:resultado/);
  });

  it("erro na ferramenta vira mensagem de erro, não derruba o loop", async () => {
    const failing: ToolExecutor = {
      tools: () => [{ name: "boom", description: "x", inputSchema: {} }],
      call: async () => {
        throw new Error("falhou");
      },
    };
    const res = await runToolLoop("faça Z", {
      provider: new FakeProvider(),
      model: "fake",
      executor: failing,
    });
    // turno 2 ecoa o resultado-erro da ferramenta
    expect(res.text).toContain("ERRO: falhou");
    expect(res.turns).toBe(2);
  });

  it("respeita o teto de voltas", async () => {
    // provider que SEMPRE pede ferramenta → o teto encerra o loop
    const alwaysTool = {
      id: "always",
      async *chat() {
        yield {
          text: "",
          toolCalls: [{ id: "c", name: "echo", arguments: {} }],
        };
      },
      async fim() {
        return "";
      },
      countTokens: () => 0,
    };
    const res = await runToolLoop("loop", {
      provider: alwaysTool,
      model: "fake",
      executor: executor(),
      maxTurns: 3,
    });
    expect(res.turns).toBe(3);
    expect(res.calls).toHaveLength(3);
  });

  it("modelo VAZIO sem ferramenta → recupera (NUNCA volta '(sem resposta)')", async () => {
    // 1ª chamada (com tools) volta vazia sem tool calls; a recuperação (sem tools) volta texto.
    const emptyThenText = {
      id: "empty",
      async *chat(req: { tools?: unknown[] }) {
        if (req.tools && req.tools.length) yield { text: "", toolCalls: [] };
        else yield { text: "Aqui está sua resposta de verdade.", toolCalls: [] };
      },
      async fim() {
        return "";
      },
      countTokens: () => 0,
    };
    const res = await runToolLoop("oi", { provider: emptyThenText as never, model: "fake", executor: executor() });
    expect(res.text).not.toBe("");
    expect(res.text).toContain("resposta de verdade");
  });

  it("prepende o histórico (memória multi-turno) nas mensagens", async () => {
    const counter = {
      id: "counter",
      async *chat(req: { messages: unknown[] }) {
        yield { text: `msgs:${req.messages.length}`, toolCalls: [] };
      },
      async fim() {
        return "";
      },
      countTokens: () => 0,
    };
    const empty: ToolExecutor = { tools: () => [], call: async () => ({ content: "" }) };
    const res = await runToolLoop("agora", {
      provider: counter as never,
      model: "fake",
      executor: empty,
      history: [
        { role: "user", content: "antes" },
        { role: "assistant", content: "resposta anterior" },
      ],
    });
    expect(res.text).toBe("msgs:3"); // 2 do histórico + a mensagem atual
  });

  it("ao esgotar as voltas sem texto final, força um resumo (NUNCA volta vazio)", async () => {
    // pede ferramenta enquanto há tools; quando a chamada final vem SEM tools, responde texto.
    const exhausting = {
      id: "exhausting",
      async *chat(req: { tools?: unknown[] }) {
        if (req.tools && req.tools.length > 0) {
          yield { text: "", toolCalls: [{ id: "c", name: "echo", arguments: {} }] };
        } else {
          yield { text: "Já reservei o quarto; falta confirmar o pagamento.", toolCalls: [] };
        }
      },
      async fim() {
        return "";
      },
      countTokens: () => 0,
    };
    const res = await runToolLoop("reserve um hotel", {
      provider: exhausting as never,
      model: "fake",
      executor: executor(),
      maxTurns: 2,
    });
    expect(res.turns).toBe(2);
    expect(res.text).not.toBe(""); // o bug do "(sem resposta)" não acontece mais
    expect(res.text).toContain("Já reservei o quarto"); // veio da chamada final sem ferramentas
  });
});
