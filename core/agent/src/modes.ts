// core/agent/modes.ts
// Subfase 5.2 — modos do agente. Cada modo molda o comportamento do loop: se pode
// escrever no disco (allowsEdit), qual tarefa do router usa (afeta o modelo) e a
// instrução de sistema. Na linha do Roo (Code/Architect/Ask/Debug) + um Gather
// somente-leitura na linha do Void: explorar o repo sem edição surpresa.

import type { Task } from "@typer/router";
import { EDIT_SYSTEM_INSTRUCTION } from "@typer/edit";

export type ModeName = "code" | "architect" | "ask" | "debug" | "gather";

export interface Mode {
  name: ModeName;
  /** rótulo curto em pt-BR */
  label: string;
  description: string;
  /** pode propor e aplicar edições no disco? (false = somente-leitura) */
  allowsEdit: boolean;
  /** tarefa do router — escolhe o modelo (agent p/ editar, chat p/ ler) */
  task: Task;
  /** instrução de sistema do modo */
  system: string;
}

const DEBUG_PREAMBLE =
  "Você está DEPURANDO. Antes de editar, identifique a causa-raiz a partir do " +
  "contexto e da saída de erro; depois aplique a correção MÍNIMA e segura que " +
  "resolve a causa (não o sintoma). Não faça refatorações amplas.";

const ARCHITECT_SYSTEM = [
  "Você é um arquiteto de software. NÃO edite arquivos — produza um PLANO claro e",
  "acionável, em pt-BR. Estruture a resposta em:",
  "- Objetivo: o que será alcançado, em uma frase.",
  "- Passos: lista numerada, cada passo pequeno e verificável.",
  "- Arquivos afetados: caminhos prováveis e o porquê.",
  "- Riscos e decisões em aberto.",
  "Cite arquivos e linhas do contexto quando relevante. NÃO escreva blocos",
  "SEARCH/REPLACE nem aplique mudanças.",
].join("\n");

const ASK_SYSTEM = [
  "Você responde perguntas sobre este código, em pt-BR, de forma direta e correta.",
  "Use o contexto do projeto e cite arquivos e linhas quando relevante. NÃO edite",
  "nada e não proponha mudanças — apenas explique. Se não souber, diga que não sabe.",
].join("\n");

const GATHER_SYSTEM = [
  "Você está em modo somente-leitura de exploração. Mapeie e resuma o que foi pedido",
  "sobre o repositório (estrutura, responsabilidades, onde cada coisa vive), em",
  "pt-BR, citando caminhos. NUNCA proponha nem faça edições — nenhuma mudança",
  "surpresa. Apenas observe e relate o que existe.",
].join("\n");

export const MODES: Record<ModeName, Mode> = {
  code: {
    name: "code",
    label: "Code",
    description: "Editar código: propõe SEARCH/REPLACE e aplica via selo.",
    allowsEdit: true,
    task: "agent",
    system: EDIT_SYSTEM_INSTRUCTION,
  },
  debug: {
    name: "debug",
    label: "Debug",
    description: "Diagnosticar a causa-raiz e aplicar a correção mínima.",
    allowsEdit: true,
    task: "agent",
    system: `${DEBUG_PREAMBLE}\n\n${EDIT_SYSTEM_INSTRUCTION}`,
  },
  architect: {
    name: "architect",
    label: "Architect",
    description: "Planejar a mudança (somente-leitura), sem editar.",
    allowsEdit: false,
    task: "chat",
    system: ARCHITECT_SYSTEM,
  },
  ask: {
    name: "ask",
    label: "Ask",
    description: "Perguntar sobre o código (somente-leitura).",
    allowsEdit: false,
    task: "chat",
    system: ASK_SYSTEM,
  },
  gather: {
    name: "gather",
    label: "Gather",
    description: "Explorar o repositório (somente-leitura), sem edição surpresa.",
    allowsEdit: false,
    task: "chat",
    system: GATHER_SYSTEM,
  },
};

export const MODE_NAMES = Object.keys(MODES) as ModeName[];
export const DEFAULT_MODE: ModeName = "code";

export function isModeName(name: string): name is ModeName {
  return Object.prototype.hasOwnProperty.call(MODES, name);
}

/** Resolve um nome de modo. Sem argumento → DEFAULT_MODE. Nome inválido → erro. */
export function resolveMode(name?: string | null): Mode {
  if (name == null || name === "") return MODES[DEFAULT_MODE];
  const key = name.toLowerCase();
  if (!isModeName(key)) {
    throw new Error(
      `Modo "${name}" desconhecido. Use um de: ${MODE_NAMES.join(", ")}.`,
    );
  }
  return MODES[key];
}
