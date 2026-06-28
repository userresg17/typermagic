// core/router/provider.ts
// O contrato único de modelo. Tudo que fala com um provider passa por aqui.
// O núcleo chama esta interface, nunca o SDK do provider direto (ADR-004).

export type Role = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: Role;
  content: string;
  /** chamadas de ferramenta pedidas pelo assistant (role "assistant") */
  toolCalls?: ToolCall[];
  /** id da tool-call que este resultado responde (role "tool") */
  toolCallId?: string;
}

/** Spec de uma ferramenta exposta ao modelo (tool-use, 5.6). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema do input */
  inputSchema: Record<string, unknown>;
}

/** Uma chamada de ferramenta que o modelo decidiu fazer. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  messages: Message[];
  model: string;
  maxTokens?: number;
  /** instrução de sistema fora do array de mensagens (Anthropic usa campo próprio) */
  system?: string;
  /** liga o cache de prompt no prefixo estável, onde o provider suporta (2.7) */
  cache?: boolean;
  /** ferramentas disponíveis nesta volta (tool-use). Vazio/ausente = sem tools. */
  tools?: ToolSpec[];
}

/** Uso real de token reportado pelo provider, para o medidor registrar o real. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Chunk {
  text: string;
  /** presente só no chunk final: o uso real reportado pelo provider */
  usage?: TokenUsage;
  /** presente quando o modelo pediu ferramentas (tool-use); no chunk final */
  toolCalls?: ToolCall[];
}

export interface FimRequest {
  prefix: string;
  suffix: string;
  model: string;
  /** contexto extra do projeto (edit-trail + símbolos + related), montado fora */
  context?: string;
  /** liga o cache de prompt no prefixo estável (Anthropic), onde suportado */
  cache?: boolean;
  /** completar bloco (várias linhas) em vez de só a linha */
  multiline?: boolean;
  /** cancela a requisição em voo (tecla nova) */
  signal?: AbortSignal;
}

/**
 * Cada provider implementa o mesmo contrato: chat com streaming, FIM para
 * autocomplete e contagem de token. Trocar um modelo por outro é trocar a
 * implementação, não o chamador.
 */
export interface Provider {
  /** identificador estável do provider, ex. "anthropic", "fake" */
  readonly id: string;
  chat(req: ChatRequest): AsyncIterable<Chunk>;
  fim(req: FimRequest): Promise<string>;
  countTokens(text: string): number;
}
