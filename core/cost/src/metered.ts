// core/cost/metered.ts
// Middleware que envolve um Provider e mede cada chamada. O medidor estima a
// entrada antes (via countTokens) e registra a saída real ao fim do stream. É
// o "medidor no caminho de toda chamada" da arquitetura, sem o núcleo saber.

import type { Provider, ChatRequest, Chunk, FimRequest } from "@typer/router";
import type { CostMeter } from "./meter.js";

export class MeteredProvider implements Provider {
  readonly id: string;

  constructor(
    private readonly inner: Provider,
    private readonly meter: CostMeter,
    private readonly task?: string,
  ) {
    this.id = inner.id;
  }

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    let outputText = "";
    let real: Chunk["usage"];
    for await (const chunk of this.inner.chat(req)) {
      outputText += chunk.text;
      if (chunk.usage) real = chunk.usage;
      yield chunk;
    }

    // Registra o uso REAL quando o provider o reporta (Anthropic); senão estima.
    if (real) {
      this.meter.record(this.inner.id, req.model, real, this.task);
    } else {
      const inputText =
        (req.system ?? "") + req.messages.map((m) => m.content).join("\n");
      this.meter.record(
        this.inner.id,
        req.model,
        {
          inputTokens: this.inner.countTokens(inputText),
          outputTokens: this.inner.countTokens(outputText),
        },
        this.task,
      );
    }
  }

  async fim(req: FimRequest): Promise<string> {
    return this.inner.fim(req);
  }

  countTokens(text: string): number {
    return this.inner.countTokens(text);
  }
}
