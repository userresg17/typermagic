// core/agent/hitl.ts
// Subfase 5.5 — human-in-the-loop. Duas peças:
//   1. AuditTrail: log append-only de toda ação do agente (autor, alvo, resultado).
//   2. ApprovalGate: portão configurável antes de ação sensível (aplicar/selar).
// O loop registra o que faz; a CLI (ou o editor) pede aprovação conforme a política.

export interface AuditEntry {
  /** epoch ms */
  ts: number;
  /** quem originou: o agente (modelo) ou o usuário (decisão de aprovação) */
  author: "agent" | "user";
  /** o que: "edit" | "seal" | "approval" | livre */
  action: string;
  /** alvo: caminho de arquivo, comando de teste, etc. */
  target: string;
  /** desfecho: "approved" | "denied" | "auto" | "verificado" | "rejeitado" | … */
  result: string;
  /** detalhe opcional (motivo, contagem, etc.) */
  detail?: string;
}

/** Trilha de auditoria append-only. Relógio injetável p/ teste determinístico. */
export class AuditTrail {
  private readonly log: AuditEntry[] = [];
  constructor(private readonly now: () => number = () => Date.now()) {}

  record(e: Omit<AuditEntry, "ts"> & { ts?: number }): AuditEntry {
    const entry: AuditEntry = { ts: e.ts ?? this.now(), ...e };
    this.log.push(entry);
    return entry;
  }

  entries(): readonly AuditEntry[] {
    return this.log;
  }

  /** Linha por entrada, legível em terminal/log. */
  format(): string {
    return this.log
      .map((e) => {
        const base = `[${e.author}] ${e.action} → ${e.target}: ${e.result}`;
        return e.detail ? `${base} (${e.detail})` : base;
      })
      .join("\n");
  }

  toJSON(): AuditEntry[] {
    return [...this.log];
  }
}

/** Política de aprovação para ações sensíveis. */
export type ApprovalPolicy =
  /** sempre pergunta */
  | "always"
  /** nunca pergunta (auto-aprova) */
  | "never"
  /** pergunta só na 1ª tentativa; retries automáticos */
  | "first-only";

export interface ApprovalRequest {
  action: string;
  target: string;
  detail?: string;
  /** tentativa atual (p/ a política first-only) */
  attempt?: number;
}

export type Prompter = (req: ApprovalRequest) => Promise<boolean> | boolean;

/** Portão de aprovação: consulta a política, pergunta se preciso, e audita. */
export class ApprovalGate {
  constructor(
    private readonly policy: ApprovalPolicy,
    private readonly prompt: Prompter,
    private readonly audit?: AuditTrail,
  ) {}

  async approve(req: ApprovalRequest): Promise<boolean> {
    let ok: boolean;
    let result: string;
    if (this.policy === "never") {
      ok = true;
      result = "auto";
    } else if (this.policy === "first-only" && (req.attempt ?? 1) > 1) {
      ok = true;
      result = "auto";
    } else {
      ok = await this.prompt(req);
      result = ok ? "approved" : "denied";
    }
    this.audit?.record({
      author: "user",
      action: "approval",
      target: req.target,
      result,
      ...(req.detail !== undefined ? { detail: req.detail } : {}),
    });
    return ok;
  }
}

export const APPROVAL_POLICIES: ApprovalPolicy[] = [
  "always",
  "never",
  "first-only",
];

export function isApprovalPolicy(s: string): s is ApprovalPolicy {
  return (APPROVAL_POLICIES as string[]).includes(s);
}
