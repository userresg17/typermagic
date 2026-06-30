// core/agent/browser/dom.ts
// Serializa o PageState (estado lido da tela) na STRING que o sub-agente mostra ao LLM —
// no estilo browser-use: cada elemento interativo numerado, `[idx]<tag attrs> texto`, mais
// um trecho do texto da página como contexto. O modelo age pelos NÚMEROS, não por seletor.

import type { PageState, InteractiveElement } from "../tools/types.js";

function elLine(e: InteractiveElement): string {
  const attrs = [
    e.type ? `type=${e.type}` : "",
    e.role ? `role=${e.role}` : "",
    e.value ? `value="${e.value.slice(0, 30)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const head = `[${e.idx}]<${e.tag}${attrs ? " " + attrs : ""}>`;
  return e.text ? `${head} ${e.text}` : head;
}

/** PageState → texto pro LLM (lista numerada de interativos + texto da página). */
export function serializeState(state: PageState, maxText = 2000): string {
  const els = state.elements.map(elLine).join("\n");
  const pageText = state.text.replace(/\n{2,}/g, "\n").slice(0, maxText);
  return [
    `URL: ${state.url}`,
    state.title ? `Título: ${state.title}` : "",
    "",
    `ELEMENTOS INTERATIVOS (aja pelo NÚMERO; só estes são clicáveis/preenchíveis):`,
    els || "(nenhum elemento interativo detectado — talvez precise rolar/aguardar)",
    "",
    "TEXTO DA PÁGINA (contexto):",
    pageText,
  ]
    .filter(Boolean)
    .join("\n");
}
