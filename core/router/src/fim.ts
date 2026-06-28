// core/router/src/fim.ts
// Caminho de FIM (fill-in-the-middle), separado do caminho de chat. O
// autocomplete preenche o meio entre o prefixo e o sufixo do cursor. Modelos
// com FIM nativo (Codestral, DeepSeek, StarCoder via Ollama na 2.6) usam o
// endpoint próprio; modelos sem FIM (Anthropic) usam o prompt instruído abaixo.

import type { Message } from "./provider.js";
import type { RoutingPolicy } from "./route.js";
import { DEFAULT_POLICY } from "./route.js";

export const FIM_SYSTEM =
  "Você completa código. Devolva SOMENTE o trecho que entra entre o PREFIXO e o " +
  "SUFIXO, na posição do cursor. Não repita o prefixo nem o sufixo, não " +
  "explique, não use cercas de código. Se nada faltar, devolva vazio.";

/** Marcadores do prompt instruído de FIM. */
const PREFIX_TAG = "<PREFIXO>";
const SUFFIX_TAG = "<SUFIXO>";
const HOLE_TAG = "<CURSOR>";

/** Monta as mensagens do FIM instruído. Puro e testável. O `context` (edit-trail
 *  + símbolos em escopo + defs relacionadas, montado fora) entra como referência
 *  ANTES da janela do cursor — o modelo usa, mas completa só na posição. */
export function buildFimMessages(
  prefix: string,
  suffix: string,
  context?: string,
): {
  system: string;
  messages: Message[];
} {
  const ctx = context && context.trim() ? `${context.trim()}\n\n` : "";
  const content = `${ctx}${PREFIX_TAG}\n${prefix}${HOLE_TAG}${suffix}\n${SUFFIX_TAG}\n\nComplete na posição de ${HOLE_TAG}.`;
  return {
    system: FIM_SYSTEM,
    messages: [{ role: "user", content }],
  };
}

/** Limpa a resposta do modelo: tira cercas de código e repetição do prefixo. */
export function cleanFimCompletion(raw: string, prefix: string): string {
  let out = raw.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/\n?```$/, "");
  const tail = prefix.slice(-40);
  if (tail && out.startsWith(tail)) out = out.slice(tail.length);
  return out;
}

/** Modelo do caminho de FIM, pela política. Override do usuário tem prioridade. */
export function pickFimModel(
  override?: string,
  policy: RoutingPolicy = DEFAULT_POLICY,
): string {
  return override ?? policy.models.autocomplete;
}
