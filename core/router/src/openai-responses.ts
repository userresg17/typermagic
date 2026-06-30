// core/router/src/openai-responses.ts
// Caminho de inferência "com a assinatura do ChatGPT" (Plus/Pro), espelhando o Codex CLI:
// NÃO usa api.openai.com — fala com o backend PRIVADO do ChatGPT
// (chatgpt.com/backend-api/codex/responses), no formato Responses API, com header
// ChatGPT-Account-ID. É frágil por natureza (endpoint privado, sujeito a mudança e a
// bloqueio pela OpenAI) — por isso fica isolado aqui e só liga quando a credencial é OAuth.
//
// Sem teste ao vivo possível sem a conta do dono: os testes cobrem a CONSTRUÇÃO do request
// e o PARSE do stream com eventos sintéticos. O smoke real é com a assinatura logada.

import { randomUUID } from "node:crypto";
import type { ChatRequest, Chunk, FimRequest, Message, ToolSpec } from "./provider.js";
import type { Auth } from "./auth.js";
import { buildFimMessages, cleanFimCompletion } from "./fim.js";

const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

function backendHeaders(auth: Extract<Auth, { kind: "oauth" }>): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${auth.token}`,
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=experimental",
    session_id: randomUUID(),
    ...(auth.accountId ? { "ChatGPT-Account-ID": auth.accountId } : {}),
  };
}

/** Item de conteúdo do Responses API por papel. */
function contentPart(role: Message["role"], text: string) {
  // texto do usuário/sistema = input_text; do assistant = output_text.
  return { type: role === "assistant" ? "output_text" : "input_text", text };
}

/** Mapeia as mensagens do contrato p/ o `input` do Responses API + as `instructions`. */
export function toResponsesInput(system: string | undefined, messages: Message[]): {
  instructions: string | undefined;
  input: unknown[];
} {
  const sysParts: string[] = [];
  if (system) sysParts.push(system);
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      sysParts.push(m.content);
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      if (m.content) {
        input.push({ type: "message", role: "assistant", content: [contentPart("assistant", m.content)] });
      }
      for (const tc of m.toolCalls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        });
      }
    } else {
      const content: unknown[] = [contentPart(m.role, m.content)];
      // VISÃO: anexa imagens (screenshots) numa mensagem do usuário, no formato input_image.
      if (m.role === "user" && m.images?.length) {
        for (const img of m.images) {
          const url = img.startsWith("data:") ? img : `data:image/png;base64,${img}`;
          content.push({ type: "input_image", image_url: url });
        }
      }
      input.push({ type: "message", role: m.role, content });
    }
  }
  return { instructions: sysParts.length ? sysParts.join("\n\n") : undefined, input };
}

/** Ferramentas no formato Responses API (function "achatada", sem o wrapper `function`). */
export function toResponsesTools(tools?: ToolSpec[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    strict: false,
  }));
}

function buildBody(model: string, system: string | undefined, messages: Message[], tools?: ToolSpec[]) {
  const { instructions, input } = toResponsesInput(system, messages);
  // Body fiel ao Codex: store/stream forçados, reasoning+text+include, tools sempre presente,
  // tool_choice auto. NÃO mandar `metadata` (o backend Codex tem allowlist estrita de params).
  return {
    model,
    ...(instructions ? { instructions } : {}),
    input,
    tools: toResponsesTools(tools) ?? [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: "medium", summary: "auto" },
    text: { verbosity: "medium" },
    include: ["reasoning.encrypted_content"],
    store: false,
    stream: true,
  };
}

// O backend do ChatGPT (Codex) só aceita os modelos do catálogo ATUAL do Codex — o modelo
// que o roteador escolheu p/ a API pública (ex.: "gpt-4.1") é rejeitado, e a lista ROTACIONA
// sem aviso (gpt-5/gpt-5-codex/gpt-5.3-codex já saíram). Tentamos os atuais em ordem, com
// fallback no 400. Override manual: TYPER_OPENAI_CHATGPT_MODEL=<slug>.
function modelCandidates(): string[] {
  const env = process.env.TYPER_OPENAI_CHATGPT_MODEL;
  return [env, "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"].filter(
    (m): m is string => !!m && m.trim().length > 0,
  );
}

/** chat via backend do ChatGPT (assinatura), tentando os modelos Codex em ordem. */
export async function* chatViaChatGptBackend(
  req: ChatRequest,
  auth: Extract<Auth, { kind: "oauth" }>,
): AsyncIterable<Chunk> {
  const cands = modelCandidates();
  for (let i = 0; i < cands.length; i++) {
    const res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: backendHeaders(auth),
      body: JSON.stringify(buildBody(cands[i]!, req.system, req.messages, req.tools)),
    });
    if (res.ok && res.body) {
      yield* parseResponsesSse(res.body);
      return;
    }
    const detail = await res.text().catch(() => "");
    const codexUnavailable = /not supported when using Codex with a ChatGPT account/i.test(detail);
    const modelRejected = res.status === 400 && /model/i.test(detail);
    const last = i === cands.length - 1;
    // Todos os candidatos recusados: a lista de modelos do Codex rotacionou (ou a assinatura
    // expirou — a OpenAI dá o MESMO erro nos dois casos).
    if (codexUnavailable && last) {
      throw new Error(
        `nenhum modelo Codex atual foi aceito (tentei: ${cands.join(", ")}). A OpenAI rotaciona a ` +
          "lista sem aviso — force um slug com TYPER_OPENAI_CHATGPT_MODEL=<modelo> (veja o que o " +
          "`codex` usa hoje). Se persistir, confira se a assinatura ChatGPT está ativa.",
      );
    }
    if (!modelRejected || last) {
      throw new Error(`ChatGPT backend respondeu ${res.status}. ${detail.slice(0, 300)}`);
    }
    // modelo não suportado: tenta o próximo candidato
  }
}

/** FIM via backend do ChatGPT: coleta os deltas de texto num resultado só. */
export async function fimViaChatGptBackend(
  req: FimRequest,
  auth: Extract<Auth, { kind: "oauth" }>,
): Promise<string> {
  const { system, messages } = buildFimMessages(req.prefix, req.suffix, req.context);
  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: backendHeaders(auth),
    body: JSON.stringify(buildBody(modelCandidates()[0]!, system, messages)),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ChatGPT backend FIM ${res.status}. ${detail.slice(0, 300)}`);
  }
  let text = "";
  for await (const c of parseResponsesSse(res.body)) text += c.text;
  return cleanFimCompletion(text, req.prefix);
}

interface RespUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Parser do stream do Responses API (eventos `response.*`). */
export async function* parseResponsesSse(body: ReadableStream<Uint8Array>): AsyncIterable<Chunk> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const usage: RespUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

  const flush = (): Chunk => ({
    text: "",
    usage,
    ...(toolCalls.length ? { toolCalls: [...toolCalls] } : {}),
  });

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(line.indexOf(":") + 1).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = ev.type as string | undefined;
      if (type === "response.output_text.delta" && typeof ev.delta === "string") {
        yield { text: ev.delta };
      } else if (type === "response.output_item.done") {
        const item = ev.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          let args: Record<string, unknown> = {};
          try {
            args = item.arguments ? (JSON.parse(item.arguments as string) as Record<string, unknown>) : {};
          } catch {
            /* arguments inválidos: vazio */
          }
          toolCalls.push({
            id: (item.call_id as string) ?? (item.id as string) ?? "",
            name: (item.name as string) ?? "",
            arguments: args,
          });
        }
      } else if (type === "response.completed") {
        const u = (ev.response as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;
        if (u) {
          usage.inputTokens = (u.input_tokens as number) ?? 0;
          usage.outputTokens = (u.output_tokens as number) ?? 0;
          const details = u.input_tokens_details as Record<string, unknown> | undefined;
          usage.cacheReadTokens = (details?.cached_tokens as number) ?? 0;
        }
        yield flush();
        return;
      }
    }
  }
  yield flush();
}
