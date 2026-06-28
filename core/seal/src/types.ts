// core/seal/types.ts
// O selo é uma máquina de estados. O estado inicial é Rejeitado; uma mudança
// sobe para Verificado só quando a suíte do projeto passa. Um portão, e ele
// gateia a escrita no disco.

export interface SealConfig {
  root: string;
  /** comando de teste do projeto: string (via shell) ou argv (direto) */
  testCommand: string | string[];
  timeoutMs?: number;
}

export type SealResult =
  | {
      state: "Verificado";
      passed: true;
      output: string;
      durationMs: number;
      /** arquivos que ficaram no disco */
      applied: string[];
    }
  | {
      state: "Rejeitado";
      passed: false;
      output: string;
      durationMs: number;
      /** arquivos revertidos (a mudança não ficou no disco) */
      reverted: string[];
      reason: string;
    };
