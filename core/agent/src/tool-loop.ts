// core/agent/tool-loop.ts
// Subfase 5.6 (execução) — o loop de tool-use. O modelo recebe os specs das
// ferramentas; se pedir uma, o loop executa (via ToolExecutor, ex.: McpRegistry),
// devolve o resultado como mensagem role "tool" e repete até o modelo responder
// em texto (ou estourar o teto de voltas). Desacoplado do MCP pela interface.

import type { Message, Provider, ToolCall, ToolSpec } from "@typer/router";

export interface ToolExecutor {
  /** specs das ferramentas disponíveis (name já qualificado, ex. "fs.read") */
  tools(): ToolSpec[];
  /** executa uma chamada; retorna o texto do resultado */
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }>;
}

export interface ToolLoopOptions {
  provider: Provider;
  model: string;
  system?: string;
  executor: ToolExecutor;
  /** teto de voltas (evita laço infinito de tool-use). Default 6. */
  maxTurns?: number;
  /** memória multi-turno: turnos anteriores da conversa (antes da task atual). */
  history?: Message[];
  /** observabilidade: chamado a cada ferramenta executada */
  onToolCall?: (call: ToolCall, result: string) => void;
}

export interface ToolLoopResult {
  text: string;
  turns: number;
  /** todas as chamadas feitas, em ordem (auditoria) */
  calls: ToolCall[];
}

async function collect(
  provider: Provider,
  req: Parameters<Provider["chat"]>[0],
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  let text = "";
  let toolCalls: ToolCall[] = [];
  for await (const c of provider.chat(req)) {
    text += c.text;
    if (c.toolCalls && c.toolCalls.length) toolCalls = c.toolCalls;
  }
  return { text, toolCalls };
}

export async function runToolLoop(
  task: string,
  opts: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const maxTurns = opts.maxTurns ?? 6;
  const tools = opts.executor.tools();
  const messages: Message[] = [...(opts.history ?? []), { role: "user", content: task }];
  const calls: ToolCall[] = [];
  let lastText = "";

  for (let turn = 1; turn <= maxTurns; turn++) {
    const { text, toolCalls } = await collect(opts.provider, {
      messages,
      model: opts.model,
      maxTokens: 4096,
      ...(opts.system !== undefined ? { system: opts.system } : {}),
      tools,
    });
    lastText = text;

    if (toolCalls.length === 0) {
      return { text, turns: turn, calls };
    }

    // a volta do assistant que pediu as ferramentas
    messages.push({ role: "assistant", content: text, toolCalls });

    for (const tc of toolCalls) {
      calls.push(tc);
      let resultText: string;
      try {
        const r = await opts.executor.call(tc.name, tc.arguments);
        resultText = r.isError ? `ERRO: ${r.content}` : r.content;
      } catch (e) {
        resultText = `ERRO: ${e instanceof Error ? e.message : String(e)}`;
      }
      opts.onToolCall?.(tc, resultText);
      messages.push({ role: "tool", content: resultText, toolCallId: tc.id });
    }
  }

  // Esgotou as voltas. Se a última volta foi só ferramentas (sem texto final), faz UMA
  // chamada final SEM ferramentas — assim o usuário SEMPRE recebe um status legível, nunca
  // uma resposta vazia ("(sem resposta)"). Tarefas longas (ex.: reservar hotel) param aqui.
  if (!lastText.trim()) {
    const { text } = await collect(opts.provider, {
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Você atingiu o limite de passos sem concluir. Em PORTUGUÊS, resuma o que já fez, o que ainda falta, e o que precisa de mim p/ continuar. NÃO chame ferramentas.",
        },
      ],
      model: opts.model,
      maxTokens: 1024,
      ...(opts.system !== undefined ? { system: opts.system } : {}),
    });
    return {
      text: text.trim() || "Atingi o limite de passos sem terminar. Me peça p/ continuar de onde parei.",
      turns: maxTurns,
      calls,
    };
  }

  return { text: lastText, turns: maxTurns, calls };
}
