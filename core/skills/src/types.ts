// core/skills/types.ts
// Skills no formato Agent Skills (SKILL.md). Cada tarefa concluída pode virar
// uma capacidade reutilizável — mas só entra na biblioteca se passou no selo
// (arquitetura, componente 6). Uma biblioteca de procedimento não verificado
// amplifica alucinação.

// Uniões definidas localmente (não importar de @typer/agent: agent depende de
// skills, importar de volta criaria ciclo). Espelham Permission/ExecContext.
export type SkillPermission = "read" | "write" | "exec" | "network" | "meta";
export type SkillExec = "in_process" | "subprocess" | "microvm";

/** Manifesto de capacidade: o que a skill DECLARA precisar. Default-deny no que não
 *  declarou — uma skill que não pediu rede não recebe rede. Conserto do achado da Cisco. */
export interface CapabilityManifest {
  /** ferramentas que a skill vai chamar (ex.: ["read_file","run_command"]) */
  tools?: string[];
  permissions?: SkillPermission[];
  exec?: SkillExec[];
  /** hosts de rede que precisa (allowlist declarada) */
  network?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** a metodologia destilada (corpo do SKILL.md) */
  methodology: string;
  /** versão do código que a skill assume; invalida quando o código muda */
  codeVersion: string;
  /** só true depois de passar pelo selo */
  sealed: boolean;
  createdAt: string;
  // --- registry assinado (F3) ---
  /** capacidades declaradas (default-deny no que não está aqui) */
  manifest?: CapabilityManifest;
  /** assinatura Ed25519 da forma canônica do conteúdo (verificável) */
  signature?: string;
  /** id da chave pública do publisher (ed25519:...) */
  publisher?: string;
  /** hash de integridade do conteúdo (sha256 curto) — base da revogação */
  hash?: string;
  /** confinamento de execução: none (induzida local, confiável) | subprocess | microvm (importada, quarentena) */
  confinement?: "none" | "subprocess" | "microvm";
}

/** Uma tarefa concluída, da qual uma skill candidata é destilada. */
export interface CompletedTask {
  name: string;
  description: string;
  methodology: string;
  codeVersion: string;
  at?: string;
}

import type { SealResult } from "@typer/seal";

export interface SkillStore {
  /** destila um candidato (ainda não selado) de uma tarefa concluída */
  induce(task: CompletedTask): Skill;
  /** porta de verificação: a skill só entra na biblioteca se o selo passou */
  seal(skill: Skill, result: SealResult): Promise<Skill | null>;
  /** recupera skills aplicáveis a uma tarefa, por embedding + aplicabilidade */
  retrieve(task: string, k: number): Promise<Skill[]>;
  /** invalida skills que assumem uma versão de código diferente da atual */
  invalidate(currentCodeVersion: string): number;
}
