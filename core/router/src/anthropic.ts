// core/router/anthropic.ts
// Adaptador Anthropic. Fetch nativo, sem SDK, para o núcleo não carregar
// dependência de provider (ADR-004). Streaming via SSE da Messages API.

import type {
  Provider,
  ChatRequest,
  Chunk,
  FimRequest,
  Message,
  ToolSpec,
} from "./provider.js";
import { resolveAuth, authHeaders, type Auth } from "./auth.js";
import { buildFimMessages, cleanFimCompletion } from "./fim.js";

/** Mensagens no formato content-block da Messages API (tool_use/tool_result). */
export function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId, content: m.content },
        ],
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function toAnthropicTools(tools?: ToolSpec[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
// Header exigido quando a credencial é um token OAuth do Claude Code (não API key).
// Valor público do client oficial — CONFIRMAR contra a versão atual do Claude Code.
const OAUTH_BETA = "oauth-2025-04-20";

// Com token OAuth (assinatura), o PRIMEIRO bloco de system precisa ser exatamente esta
// identidade — é o que faz a Anthropic rotear a cobrança p/ o plano Pro/Max. Sem isso, a
// request com token OAuth não é aceita no plano.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** Headers da Anthropic conforme a credencial. Com OAuth, manda anthropic-beta e
 *  nunca x-api-key (authHeaders já devolve só o Bearer p/ oauth). */
function anthropicHeaders(auth: Auth): Record<string, string> {
  return {
    "content-type": "application/json",
    ...authHeaders(auth, "x-api-key"),
    "anthropic-version": API_VERSION,
    ...(auth.kind === "oauth" ? { "anthropic-beta": OAUTH_BETA } : {}),
  };
}

type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

/** Monta o campo `system`. Sem OAuth: comportamento original (string, ou bloco com
 *  cache_control quando o cache está ligado). Com OAuth: array começando pela identidade
 *  do Claude Code (exigência da Anthropic p/ rotear ao plano), seguida do system real. */
function buildSystem(text: string | undefined, cache: boolean | undefined, isOauth: boolean): string | SystemBlock[] | undefined {
  if (!isOauth) {
    if (text && cache) return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
    return text;
  }
  const blocks: SystemBlock[] = [{ type: "text", text: CLAUDE_CODE_IDENTITY }];
  if (text) blocks.push(cache ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text });
  return blocks;
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    const auth = await resolveAuth("anthropic");
    if (auth.kind === "none") {
      throw new Error(
        "Sem credencial Anthropic. Defina TYPER_ANTHROPIC_KEY, um token OAuth (TYPER_ANTHROPIC_OAUTH) ou grave no keychain.",
      );
    }

    const joinedSystem = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const systemText = req.system ?? (joinedSystem || undefined);

    // Cache de prompt (2.7): o system é o prefixo estável. Com cache ligado, marca um
    // breakpoint ephemeral nele. Com OAuth, a identidade do Claude Code entra na frente.
    const system = buildSystem(systemText, req.cache, auth.kind === "oauth");

    const res = await fetch(API_URL, {
      method: "POST",
      headers: anthropicHeaders(auth),
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        stream: true,
        ...(system ? { system } : {}),
        ...(toAnthropicTools(req.tools) ? { tools: toAnthropicTools(req.tools) } : {}),
        messages: toAnthropicMessages(req.messages),
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Anthropic respondeu ${res.status}. ${detail.slice(0, 500)}`,
      );
    }

    yield* parseSse(res.body);
  }

  // FIM via prompt instruído (Anthropic não tem endpoint FIM nativo). Chamada
  // não-streaming, max_tokens curto, para latência baixa de autocomplete.
  async fim(req: FimRequest): Promise<string> {
    const auth = await resolveAuth("anthropic");
    if (auth.kind === "none") {
      throw new Error(
        "Sem credencial Anthropic. Defina TYPER_ANTHROPIC_KEY, um token OAuth (TYPER_ANTHROPIC_OAUTH) ou grave no keychain.",
      );
    }
    const { system, messages } = buildFimMessages(req.prefix, req.suffix, req.context);
    const user = messages[0]?.content ?? "";
    // cache de prefixo: o bloco do usuário (prefixo do arquivo, estável) entra
    // como content-block com cache_control — só o sufixo volátil paga preço cheio.
    const userBlock = req.cache
      ? [{ type: "text", text: user, cache_control: { type: "ephemeral" } }]
      : user;
    const res = await fetch(API_URL, {
      method: "POST",
      headers: anthropicHeaders(auth),
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.multiline ? 512 : 256,
        system: buildSystem(system, req.cache, auth.kind === "oauth"),
        messages: [{ role: "user", content: userBlock }],
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic FIM ${res.status}. ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return cleanFimCompletion(text, req.prefix);
  }

  // Estimativa grosseira até a 2.3 plugar contagem real.
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/** Lê o stream SSE da Messages API e emite o texto dos deltas. */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Chunk> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  // uso real, acumulado dos eventos message_start e message_delta
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  // blocos tool_use em construção, por índice: acumula o input JSON (streamado)
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

  const finalToolCalls = () => {
    const calls = [...toolBlocks.values()].map((b) => {
      let args: Record<string, unknown> = {};
      try {
        args = b.json ? (JSON.parse(b.json) as Record<string, unknown>) : {};
      } catch {
        /* input parcial/ruim: argumentos vazios */
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
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          toolBlocks.set(ev.index as number, {
            id: ev.content_block.id as string,
            name: ev.content_block.name as string,
            json: "",
          });
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta") {
          const b = toolBlocks.get(ev.index as number);
          if (b) b.json += (ev.delta.partial_json as string) ?? "";
        } else if (ev.type === "content_block_delta" && ev.delta?.text) {
          yield { text: ev.delta.text as string };
        } else if (ev.type === "message_start" && ev.message?.usage) {
          const u = ev.message.usage;
          usage.inputTokens = u.input_tokens ?? 0;
          usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
          usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
        } else if (ev.type === "message_delta" && ev.usage?.output_tokens) {
          usage.outputTokens = ev.usage.output_tokens;
        }
      } catch {
        /* linha parcial: ignora, o próximo chunk completa */
      }
    }
  }
  yield { text: "", usage, ...(finalToolCalls() ? { toolCalls: finalToolCalls()! } : {}) };
}
