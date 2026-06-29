// core/agent/tools/types.ts
// Modelo de dados da camada de ferramentas do agente (AGENT_TOOLS.md §3). Três
// eixos ortogonais decididos no despacho: permissão (o que faz), contexto de
// execução (onde roda, vem da confiança da origem) e selo (escrita do agente só
// vale depois da suíte passar). Tudo auditado.

import type { Embedder } from "@typer/index";

export type Permission = "read" | "write" | "exec" | "network" | "meta";
export type ExecContext = "in_process" | "subprocess" | "microvm";
export type Tier = "core" | "lazy";

/** Efeito externo de uma ferramenta — ação que muta algo fora do workspace (rede,
 *  histórico git, processo). Ausente = sem efeito externo (ou contido em sandbox).
 *  `reversible:false` (irreversível) é a classe que uma superfície autônoma
 *  (scheduler/gateway) NUNCA executa sozinha — exige selo humano. `kind` diz ao
 *  policy gate qual allowlist aplicar. */
export interface ExternalEffect {
  external: true;
  reversible: boolean;
  kind: "network" | "exec" | "vcs";
}

export interface ToolParam {
  name: string;
  type: string; // "string" | "number" | "boolean" | "string[]" | "Range" | ...
  required: boolean;
  description: string;
}

export interface ToolResult {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
}

export interface AuditEvent {
  tool: string;
  args: Record<string, unknown>;
  origin: "user" | "agent";
  result: "ok" | "error" | "denied";
  at: string; // ISO 8601
}

/** Adaptador de microVM (código não confiável). Stub por padrão — não há microVM
 *  real no v1; ferramentas de sandbox degradam com erro claro se ausente. */
export interface MicroVm {
  run(code: string, lang: string): Promise<string>;
  snapshot(id: string): Promise<string>;
  restore(snapshot: string): Promise<void>;
}

/** Sessão de navegador (Playwright) injetada nas ferramentas browser_*. Persiste entre
 *  chamadas de UMA tarefa (perfil isolado p/ cookies). Ausente → as ferramentas degradam
 *  com erro claro (instale playwright e habilite o browser). O valor de campos sensíveis
 *  é digitado por fill() vindo do vault — nunca passa pelo modelo. */
export interface BrowserSession {
  goto(url: string): Promise<void>;
  /** texto/acessibilidade legível da página (p/ o modelo entender o conteúdo) */
  text(): Promise<string>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  /** PNG em base64 (p/ o resumo do HITL / depuração) */
  screenshot(): Promise<string>;
  url(): Promise<string>;
  /** clica e espera a página assentar (submit/pay — ação IRREVERSÍVEL) */
  submit(selector: string): Promise<void>;
  close(): Promise<void>;
}

/** Dependências opcionais p/ ferramentas que precisam de mais que o workspace.
 *  Ausentes → a ferramenta cai num default (ex.: embedder Fake) ou erro honesto. */
export interface ToolDeps {
  embedder?: Embedder;
  microvm?: MicroVm;
  /** navegador real (Playwright) p/ as ferramentas browser_* */
  browser?: BrowserSession;
  /** preferir modelo/embedder local (Ollama) quando aplicável */
  local?: boolean;
  /** tem chave OpenAI? (escolha de embedder) */
  hasOpenAI?: boolean;
  /** comando de teste do projeto (run_tests, coverage) */
  testCommand?: string;
  /** registry MCP p/ use_mcp_tool (tipado solto p/ não acoplar) */
  mcp?: {
    call(qualifiedName: string, args: Record<string, unknown>): Promise<unknown>;
    list?: () => Array<{ qualifiedName: string }>;
  };
}

export interface ToolContext {
  workspace: string;
  origin: "user" | "agent"; // quem pediu
  approve: (reason: string) => Promise<boolean>; // human-in-the-loop
  audit: (e: AuditEvent) => void;
  seal: { verify: (diff: unknown) => Promise<{ passed: boolean }> };
  deps?: ToolDeps;
}

export interface Tool {
  name: string;
  family: string;
  description: string;
  params: ToolParam[];
  returns: string;
  permission: Permission;
  exec: ExecContext;
  tier: Tier;
  requiresApproval: boolean;
  sealGated: boolean;
  /** efeito externo (rede/git/processo); ausente = sem efeito externo */
  effect?: ExternalEffect;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Helper de auditoria: timestamp ISO sem depender de relógio direto no handler. */
export function nowIso(): string {
  return new Date().toISOString();
}
