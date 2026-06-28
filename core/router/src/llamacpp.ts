// core/router/src/llamacpp.ts
// Adaptador llama.cpp (llama-server) — modelo local acelerado por GPU via VULKAN
// (contorna o ROCm; roda em AMD antigas como a RX 560/gfx803). Chat pela API
// OpenAI-compat (/v1/chat/completions, SSE); FIM pelo /infill NATIVO. Sem chave: é
// local. URL em TYPER_LLAMACPP_URL (default 127.0.0.1:8080).

import type { Provider, ChatRequest, Chunk, FimRequest, Message } from "./provider.js";

const DEFAULT_URL = "http://127.0.0.1:8080";

function baseUrl(): string {
  return (process.env.TYPER_LLAMACPP_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

function toMessages(system: string | undefined, messages: Message[]): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") continue;
    out.push({ role: m.role === "tool" ? "user" : m.role, content: m.content });
  }
  return out;
}

export class LlamaCppProvider implements Provider {
  readonly id = "llamacpp";

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: toMessages(req.system, req.messages),
        max_tokens: req.maxTokens ?? 1024,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      const d = await res.text().catch(() => "");
      throw new Error(`llama.cpp chat ${res.status}. ${d.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const t = j.choices?.[0]?.delta?.content;
          if (t) yield { text: t };
        } catch {
          /* linha SSE parcial: ignora */
        }
      }
    }
  }

  // FIM nativo via /infill. O contexto do projeto entra no prefixo.
  async fim(req: FimRequest): Promise<string> {
    const prefix = req.context && req.context.trim() ? `${req.context.trim()}\n${req.prefix}` : req.prefix;
    const res = await fetch(`${baseUrl()}/infill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input_prefix: prefix,
        input_suffix: req.suffix,
        n_predict: req.multiline ? 256 : 64,
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`llama.cpp infill ${res.status}. ${d.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: string };
    return data.content ?? "";
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
