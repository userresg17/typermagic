// core/agent/types.ts
// Tipos do loop de agente do Estágio 4: propor edição, selar, e na rejeição
// devolver o erro ao modelo e tentar de novo, até um teto de tentativas.

import type { Provider } from "@typer/router";
import type { FilePlan } from "@typer/edit";
import type { Seal, SealResult } from "@typer/seal";
import type { AuditTrail } from "./hitl.js";

export interface AttemptInfo {
  attempt: number;
  maxAttempts: number;
  plans: FilePlan[];
  response: string;
}

export interface EditLoopOptions {
  provider: Provider;
  model: string;
  root: string;
  testCommand: string | string[];
  /** teto de tentativas (1 = sem retry). Default 2. */
  maxAttempts?: number;
  /** instrução de sistema base (ex.: do modo). Default EDIT_SYSTEM_INSTRUCTION. */
  system?: string;
  /** injetável para teste; default new Seal() */
  seal?: Seal;
  /** chamado após o plano e antes de selar; retorne false para cancelar */
  beforeSeal?: (info: AttemptInfo) => Promise<boolean> | boolean;
  /** chamado após cada selo */
  afterSeal?: (info: AttemptInfo, result: SealResult) => void;
  /** trilha de auditoria (5.5): registra edições e desfecho do selo */
  audit?: AuditTrail;
}

export type EditLoopOutcome =
  | { state: "Verificado"; attempts: number; result: SealResult }
  | { state: "Rejeitado"; attempts: number; result: SealResult }
  | { state: "SemEdicoes"; attempts: number }
  | { state: "Cancelado"; attempts: number };
