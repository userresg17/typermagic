// core/engine/types.ts
// Contrato público da Engine API. Toda superfície (CLI/TUI, editor, gateway,
// scheduler) consome esta fachada e nada mais do núcleo. O ciclo principal é o
// runTask, que emite um stream de EngineEvent (chat token-a-token, stream de
// ferramenta, pedidos de aprovação, selo, custo). As primitivas granulares
// (retrieve/plan/verify/callTool) existem para consumidores que querem só um
// pedaço — é o que o Typer Core Server usa hoje.

import type {
  ModeName,
  ApprovalPolicy,
  ApprovalRequest,
  AuditEntry,
  Permission,
  ExecContext,
  BrowserSession,
} from "@typer/agent";
import type { FilePlan } from "@typer/edit";
import type { SealResult } from "@typer/seal";
import type { Handoff } from "@typer/handoff";

/** Identidade da superfície — base da concessão de capacidade por superfície.
 *  Uma mensagem que chega de um gateway opera num conjunto reduzido; o terminal
 *  local opera com confiança total. */
export type SurfaceId =
  | "cli"
  | "tui"
  | "editor"
  | `gateway:${string}` // gateway:whatsapp, gateway:telegram, ...
  | "scheduler";

/** Concessão de capacidade (default-deny por superfície). Espelha o modelo das 50
 *  ferramentas: o que a ferramenta pode FAZER (permission) e ONDE roda (exec). O
 *  broker (capability.ts) casa cada ferramenta contra este grant antes do dispatch. */
export interface CapabilityGrant {
  permissions: Permission[];
  exec: ExecContext[];
  /** allowlist/denylist explícita por nome de ferramenta (precede os eixos acima) */
  tools?: { allow?: string[]; deny?: string[] };
}

/** Recursos opt-in que hoje são flags da CLI. Ausentes → comportamento base. */
export interface EngineFeatures {
  /** recuperação híbrida (índice semântico + grafo + texto) em vez de ripgrep cru */
  semantic?: boolean;
  /** lê a memória relevante no contexto e grava episódio no sucesso */
  memory?: boolean;
  /** re-prima a âncora do handoff em camadas no topo do contexto */
  handoff?: boolean;
  /** recall de skills verificadas; induz+sela no sucesso (gateado pelo selo) */
  skills?: boolean;
  /** conecta servidores MCP de .typer/mcp.json (tool-use em modo read-only) */
  mcp?: boolean;
  /** destila fatos semânticos da memória episódica (com memory) */
  consolidate?: boolean;
  /** o agente pode chamar as 50 ferramentas internas no loop (broker+policy+selo) */
  tools?: boolean;
}

export interface EngineConfig {
  /** raiz do workspace */
  root: string;
  /** quem está na frente — decide a concessão de capacidade padrão */
  surface: SurfaceId;
  /** provider BYOK preferido (anthropic/openai/ollama/llamacpp); null = auto */
  provider?: string | null;
  /** preferir modelo/embedder local (Ollama/llama.cpp) */
  local?: boolean;
  /** override de modelo */
  model?: string | null;
  /** modo do agente (code/architect/ask/debug/gather); default code */
  mode?: ModeName;
  /** política de aprovação HITL; default first-only */
  approval?: ApprovalPolicy;
  /** usar ripgrep na montagem de contexto (default true; --no-grep desliga) */
  grep?: boolean;
  /** comando de teste do projeto que alimenta o selo */
  testCommand?: string | string[];
  /** teto de tentativas no loop de edição com selo; default 2 */
  attempts?: number;
  /** concessão de capacidade explícita; default = defaultGrantFor(surface) */
  capabilities?: CapabilityGrant;
  /** grava a trajetória assinada da tarefa em .typer/trajectories (F5) */
  record?: boolean;
  /** recursos opt-in */
  features?: EngineFeatures;
  /** navegador real (Playwright) compartilhado p/ as tarefas (ferramentas browser_*) */
  browser?: BrowserSession;
  /** cofre cifrado p/ vault_fill (tipado solto — não acopla @typer/vault) */
  vault?: { get(field: string): string | undefined; has(field: string): boolean; fields(): string[] };
  /** pergunta algo ao usuário pelo canal e espera a resposta (esclarecimento/OTP) */
  ask?: (kind: "clarify" | "otp", question: string) => Promise<string>;
}

export interface TaskRequest {
  /** instrução do usuário (canal de instrução — nunca misturado com conteúdo) */
  prompt: string;
  /** arquivos-âncora para o contexto */
  files?: string[];
  /** override de modo por tarefa */
  mode?: ModeName;
}

/** Desfecho de uma tarefa. Espelha os estados do selo e dos modos read-only. */
export type TaskOutcome =
  | { state: "Verificado"; attempts: number }
  | { state: "Rejeitado"; attempts: number; reason: string }
  | { state: "Aplicado"; files: string[] }
  | { state: "Respondido" }
  | { state: "SemEdicoes" }
  | { state: "Cancelado" };

/** Resumo de um plano de edição para a superfície renderizar (sem vazar o FilePlan
 *  inteiro para canais que não precisam dele; a CLU usa o `plans` cru). */
export interface PlanView {
  file: string;
  status: string;
}

/** Stream de eventos — o contrato de observabilidade comum a toda superfície.
 *  Cada `console.error` da CLI antiga vira um evento; cada chunk de chat vira um
 *  `token`. A lógica de negócio não muda — muda quem recebe a saída. */
export type EngineEvent =
  | { type: "info"; message: string }
  | { type: "context"; files: number; snippets: number; approxTokens: number }
  | { type: "token"; text: string }
  | { type: "tool.call"; name: string; args: Record<string, unknown> }
  | { type: "tool.result"; name: string; ok: boolean; preview: string }
  | { type: "policy"; tool: string; decision: "allow" | "approve" | "deny"; reason?: string; preview?: string }
  | { type: "plan"; plans: FilePlan[]; attempt: number }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "seal"; state: SealResult["state"]; attempt: number; reason?: string }
  | { type: "handoff"; reprimed: boolean; decisions?: number }
  | { type: "memory"; action: "recall" | "record" | "consolidate"; count: number }
  | { type: "audit"; entry: AuditEntry }
  | { type: "cost"; inputTokens: number; outputTokens: number; usd: number | null }
  | { type: "done"; outcome: TaskOutcome }
  | { type: "error"; message: string };

/** Callbacks que a superfície fornece. O único ponto de HITL: a Engine pede,
 *  a superfície decide (terminal, modal do editor, allowlist do gateway). */
export interface EngineHost {
  approve(req: ApprovalRequest): Promise<boolean> | boolean;
}

export interface Engine {
  /** Ciclo principal: tarefa → contexto → planejar/editar/verificar/tool-use,
   *  emitindo eventos. É o que CLI/TUI/gateway consomem. */
  runTask(req: TaskRequest): AsyncIterable<EngineEvent>;

  // Primitivas granulares (o que o Typer Core Server já chama hoje, unificadas):
  /** monta o bloco de contexto (ripgrep ou híbrido) para uma consulta */
  retrieve(query: string, files?: string[]): Promise<string>;
  /** pede ao modelo blocos SEARCH/REPLACE e devolve o plano (sem aplicar) */
  plan(prompt: string, files?: string[]): Promise<{ plans: FilePlan[]; raw: string }>;
  /** o selo de código: aplica o plano, roda a suíte, mantém ou reverte */
  verify(plans: FilePlan[]): Promise<SealResult>;
  /** executa uma das 50 ferramentas pelo registry, com o broker de capacidade */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** carrega a âncora de handoff do disco (ou null) */
  handoff(): Promise<Handoff | null>;
  /** trilha de auditoria acumulada nesta instância */
  audit(): readonly AuditEntry[];
  /** fecha recursos (servidores MCP, etc.) */
  dispose(): Promise<void>;
}
