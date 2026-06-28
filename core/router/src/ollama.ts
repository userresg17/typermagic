// core/router/src/ollama.ts
// Adaptador Ollama — modelos locais (local-first, privacidade máxima, offline).
// Fetch nativo, sem SDK. Chat via /api/chat (NDJSON streaming); FIM via
// /api/generate com `suffix`, que é FIM NATIVO nos modelos de código (codellama,
// deepseek-coder, qwen2.5-coder, starcoder2). Sem chave: é local.

import type {
  Provider,
  ChatRequest,
  Chunk,
  FimRequest,
  Message,
  ToolSpec,
} from "./provider.js";

const DEFAULT_URL = "http://localhost:11434";

function baseUrl(): string {
  return (process.env.TYPER_OLLAMA_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

/** Mensagens no formato Ollama (/api/chat), com tool_calls e role tool. */
export function toOllamaMessages(
  system: string | undefined,
  messages: Message[],
): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function toOllamaTools(tools?: ToolSpec[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/** Extrai o delta de texto de uma linha NDJSON do /api/chat. Puro e testável. */
export function parseOllamaChatLine(line: string): string | null {
  if (!line.trim()) return null;
  try {
    const ev = JSON.parse(line) as { message?: { content?: string } };
    return ev.message?.content ?? null;
  } catch {
    return null;
  }
}

export class OllamaProvider implements Provider {
  readonly id = "ollama";

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    const res = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: toOllamaMessages(req.system, req.messages),
        stream: true,
        ...(toOllamaTools(req.tools) ? { tools: toOllamaTools(req.tools) } : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama respondeu ${res.status}. ${detail.slice(0, 300)}`);
    }
    yield* parseNdjson(res.body);
  }

  // FIM nativo: /api/generate com prompt=prefixo e suffix=sufixo. O contexto do
  // projeto (montado fora) entra como prefixo do prompt (em comentário), antes do
  // prefixo real do cursor — o modelo usa como referência.
  async fim(req: FimRequest): Promise<string> {
    const prompt = req.context && req.context.trim()
      ? `${req.context.trim()}\n${req.prefix}`
      : req.prefix;
    const res = await fetch(`${baseUrl()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        prompt,
        suffix: req.suffix,
        stream: false,
        ...(req.multiline ? {} : { options: { num_predict: 128 } }),
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama FIM ${res.status}. ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { response?: string };
    return data.response ?? "";
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

/** Extrai tool_calls de uma linha NDJSON do /api/chat (puro). */
export function parseOllamaToolCalls(line: string): OllamaToolCall[] {
  if (!line.trim()) return [];
  try {
    const ev = JSON.parse(line) as {
      message?: { tool_calls?: OllamaToolCall[] };
    };
    return ev.message?.tool_calls ?? [];
  } catch {
    return [];
  }
}

async function* parseNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Chunk> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  // Ollama não dá id de tool-call → sintetizamos por ordem de chegada.
  const calls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
  const absorb = (line: string) => {
    for (const tc of parseOllamaToolCalls(line)) {
      calls.push({
        id: `call-${calls.length + 1}`,
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? {},
      });
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const text = parseOllamaChatLine(line);
      if (text) yield { text };
      absorb(line);
    }
  }
  const tail = parseOllamaChatLine(buf);
  if (tail) yield { text: tail };
  absorb(buf);
  if (calls.length) yield { text: "", toolCalls: calls };
}
