// core/router/src/openai.ts
// Adaptador OpenAI. Mesmo contrato Provider, fetch nativo, sem SDK (ADR-004).
// Chat via /v1/chat/completions (SSE). O cache de prompt da OpenAI é automático,
// então `cache` é no-op aqui; capturamos os tokens cacheados do usage. FIM por
// prompt instruído (modelos de chat da OpenAI não têm FIM nativo).

import type {
  Provider,
  ChatRequest,
  Chunk,
  FimRequest,
  Message,
  ToolSpec,
} from "./provider.js";
import { resolveAuth, authHeaders } from "./auth.js";
import { buildFimMessages, cleanFimCompletion } from "./fim.js";
import { chatViaChatGptBackend, fimViaChatGptBackend } from "./openai-responses.js";

const API_URL = "https://api.openai.com/v1/chat/completions";

/** Mensagens no formato OpenAI, incluindo tool_calls (assistant) e role tool. */
export function toOpenAIMessages(
  system: string | undefined,
  messages: Message[],
): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function toOpenAITools(tools?: ToolSpec[]): unknown[] | undefined {
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

export class OpenAIProvider implements Provider {
  readonly id = "openai";

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    const auth = await resolveAuth("openai");
    if (auth.kind === "none") {
      throw new Error(
        "Sem credencial OpenAI. Defina TYPER_OPENAI_KEY, um token OAuth (TYPER_OPENAI_OAUTH) ou grave no keychain.",
      );
    }
    // Login com a assinatura do ChatGPT → backend privado (Responses API), não api.openai.com.
    if (auth.kind === "oauth") {
      yield* chatViaChatGptBackend(req, auth);
      return;
    }
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(auth, "bearer") },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        stream: true,
        stream_options: { include_usage: true },
        ...(toOpenAITools(req.tools) ? { tools: toOpenAITools(req.tools) } : {}),
        messages: toOpenAIMessages(req.system, req.messages),
      }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI respondeu ${res.status}. ${detail.slice(0, 300)}`);
    }
    yield* parseSse(res.body);
  }

  async fim(req: FimRequest): Promise<string> {
    const auth = await resolveAuth("openai");
    if (auth.kind === "none") {
      throw new Error(
        "Sem credencial OpenAI. Defina TYPER_OPENAI_KEY, um token OAuth (TYPER_OPENAI_OAUTH) ou grave no keychain.",
      );
    }
    if (auth.kind === "oauth") return fimViaChatGptBackend(req, auth);
    const { system, messages } = buildFimMessages(req.prefix, req.suffix, req.context);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(auth, "bearer") },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.multiline ? 512 : 256,
        messages: toOpenAIMessages(system, messages),
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI FIM ${res.status}. ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return cleanFimCompletion(text, req.prefix);
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Chunk> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  // tool_calls em construção, por índice: id + name fixos, arguments streamados.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  const finalToolCalls = () => {
    const calls = [...toolAcc.values()].map((b) => {
      let args: Record<string, unknown> = {};
      try {
        args = b.args ? (JSON.parse(b.args) as Record<string, unknown>) : {};
      } catch {
        /* arguments parciais/ruins: vazio */
      }
      return { id: b.id, name: b.name, arguments: args };
    });
    return calls.length ? calls : undefined;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") {
        yield { text: "", usage, ...(finalToolCalls() ? { toolCalls: finalToolCalls()! } : {}) };
        return;
      }
      try {
        const ev = JSON.parse(payload);
        const choice = ev.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) yield { text: delta as string };
        const tcs = choice?.delta?.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx = (tc.index ?? 0) as number;
            const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id as string;
            if (tc.function?.name) cur.name = tc.function.name as string;
            if (tc.function?.arguments) cur.args += tc.function.arguments as string;
            toolAcc.set(idx, cur);
          }
        }
        if (ev.usage) {
          usage.inputTokens = ev.usage.prompt_tokens ?? 0;
          usage.outputTokens = ev.usage.completion_tokens ?? 0;
          usage.cacheReadTokens =
            ev.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
      } catch {
        /* linha parcial */
      }
    }
  }
  yield { text: "", usage, ...(finalToolCalls() ? { toolCalls: finalToolCalls()! } : {}) };
}
