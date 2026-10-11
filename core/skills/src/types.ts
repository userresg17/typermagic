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
  // --- skills de GUI aprendidas de tutorial (Fase 7) ---
  /** "gui" = procedimento num programa de desktop; ausente = skill de código (legado) */
  kind?: "gui";
  /** programa alvo (ex.: "DaVinci Resolve") e versão observada no tutorial */
  app?: string;
  appVersion?: string;
  /** passos estruturados p/ o ensaio (Fase 8). O corpo (methodology) é a versão legível. */
  steps?: GuiStep[];
  /** de onde veio: URL, título, instantes do vídeo */
  sources?: SkillSource[];
  /** candidate = aprendida, ainda não ensaiada/selada; sealed = passou no ensaio */
  state?: "candidate" | "sealed";
  /** último ensaio (Fase 8): quando, resultado e motivo */
  lastRehearsal?: { at: string; passed: boolean; reason?: string };
}

/** Um passo de procedimento em GUI: intenção (o quê), caminho (como), verificação. Nunca coordenadas. */
export interface GuiStep {
  n: number;
  /** o que se quer obter neste passo (ex.: "criar uma timeline nova com o clipe") */
  intent: string;
  /** como se chega lá: menu, atalho, painel, API — em ordem de preferência */
  how: string;
  /** como saber que deu certo (estado observável) */
  verify: string;
  /** atalho de teclado observado, se houver (ex.: "cmd+b") */
  shortcut?: string;
  /** chamada de API equivalente, se o programa tiver scripting (ex.: "timeline.create") */
  api?: string;
  pitfalls?: string[];
  /** instantes do vídeo-fonte (segundos) que embasam o passo */
  sources?: number[];
}

export interface SkillSource {
  url: string;
  title?: string;
  channel?: string;
  /** duração do vídeo em segundos */
  duration?: number;
  /** licença declarada no metadado, quando houver */
  license?: string;
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
