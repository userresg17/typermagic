// core/handoff/migrate.ts
// Versionamento: um handoff antigo nunca é lido por um leitor novo sem passar
// pelo migrador, para o re-primar não quebrar. Mudou a forma de uma camada,
// sobe a versão e adiciona um migrador na cadeia.

import { HANDOFF_SCHEMA_VERSION, type Handoff } from "./handoff.schema.js";

export function migrateHandoff(raw: Partial<Handoff> & { schema?: number }): Handoff {
  const v = raw.schema ?? 0;
  if (v > HANDOFF_SCHEMA_VERSION) {
    throw new Error(
      `handoff schema ${v} é mais novo que o leitor (${HANDOFF_SCHEMA_VERSION}); atualize o Typer Code`,
    );
  }
  // v1 é o schema atual. Migradores de versões anteriores entram aqui em cadeia.
  return { ...(raw as Handoff), schema: HANDOFF_SCHEMA_VERSION };
}
