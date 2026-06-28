// core/router/fake-provider.ts
// Provider falso para teste e para a fatia vertical rodar offline, sem chave.
// O núcleo fica testável sem chamar modelo nenhum.

import type { Provider, ChatRequest, Chunk, FimRequest } from "./provider.js";

export class FakeProvider implements Provider {
  readonly id = "fake";

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    const raw = req.messages.at(-1)?.content ?? "";
    // trunca para o eco offline não despejar o contexto inteiro no terminal
    const last = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;

    // tool-use determinístico p/ teste do loop: se há ferramentas e ainda não
    // houve resultado, pede a 1ª ferramenta uma vez; na volta seguinte (já com o
    // resultado), responde em texto.
    const sawToolResult = req.messages.some((m) => m.role === "tool");
    const first = req.tools?.[0];
    if (first && !sawToolResult) {
      yield {
        text: "",
        toolCalls: [
          { id: "call-1", name: first.name, arguments: { query: last } },
        ],
      };
      return;
    }

    // ecoa em pedaços para exercitar o caminho de streaming
    const palavras = `eco: ${last}`.split(" ");
    for (const [i, w] of palavras.entries()) {
      yield { text: i === 0 ? w : ` ${w}` };
    }
  }

  async fim(_req: FimRequest): Promise<string> {
    return "/* fim */";
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
