// app/agent-cli/src/render.ts
// Tradução de EngineEvent → terminal, compartilhada por todos os comandos e pelo
// REPL. É a "tela" da superfície CLI/TUI: tokens em stdout, o resto (contexto,
// plano, selo, custo, auditoria) em stderr, dim. Espelha o renderizador do @typer/cli,
// mas vive aqui porque é específico desta superfície.

import { renderPlanDiff } from "@typer/edit";
import type { Engine, EngineEvent, TaskOutcome, TaskRequest } from "@typer/engine";

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function renderDone(outcome: TaskOutcome, streamed: boolean): number {
  switch (outcome.state) {
    case "Verificado":
      console.error(green("✓ Verificado") + ` — selado em ${outcome.attempts} tentativa(s).`);
      return 0;
    case "Rejeitado":
      console.error(
        red(`✗ Rejeitado após ${outcome.attempts} tentativa(s); nada ficou no disco.`) +
          (outcome.reason ? ` (${outcome.reason})` : ""),
      );
      return 1;
    case "Aplicado":
      return 0;
    case "Respondido":
      if (streamed) process.stdout.write("\n");
      return 0;
    case "SemEdicoes":
      console.error(red("Nenhuma edição proposta."));
      return 1;
    case "Cancelado":
      console.error(dim("· cancelado, nada foi escrito."));
      return 0;
  }
}

/** Roda uma tarefa pela Engine e renderiza o stream no terminal. Devolve o código
 *  de saída e os textos acumulados (útil p/ o REPL). */
export async function runAndRender(engine: Engine, req: TaskRequest): Promise<number> {
  let code = 0;
  let streamed = false;
  const auditLines: string[] = [];
  for await (const ev of engine.runTask(req)) {
    code = renderEvent(ev, () => (streamed = true), auditLines) ?? code;
    if (ev.type === "done") code = renderDone(ev.outcome, streamed);
  }
  if (auditLines.length > 0) {
    console.error(dim("\n· trilha de auditoria:"));
    console.error(dim(auditLines.join("\n")));
  }
  return code;
}

/** Renderiza um único evento. Devolve um código de saída só p/ "error". */
export function renderEvent(
  ev: EngineEvent,
  markStreamed: () => void,
  auditLines: string[],
): number | undefined {
  switch (ev.type) {
    case "info":
      console.error(dim(`· ${ev.message}`));
      break;
    case "context":
      console.error(
        dim(`· contexto: ${ev.files} arquivo(s), ${ev.snippets} trecho(s), ~${ev.approxTokens} tokens`),
      );
      break;
    case "token":
      process.stdout.write(ev.text);
      markStreamed();
      break;
    case "tool.call":
      console.error(dim(`  ↳ ${ev.name}(${JSON.stringify(ev.args)})`));
      break;
    case "tool.result":
      console.error(dim(`    → ${ev.preview}`));
      break;
    case "plan":
      for (const p of ev.plans) {
        console.error(renderPlanDiff(p, { color: true }));
        console.error("");
      }
      break;
    case "approval":
      break;
    case "seal":
      if (ev.state === "Verificado") console.error(green("✓ suíte passou") + ` (tentativa ${ev.attempt})`);
      else
        console.error(
          red("✗ suíte falhou") + ` (tentativa ${ev.attempt})` + (ev.reason ? ` — ${ev.reason}` : ""),
        );
      break;
    case "handoff":
      if (ev.reprimed) console.error(dim("· handoff: âncora re-primada"));
      else console.error(dim(`· handoff: ${ev.decisions ?? 0} decisão(ões) registradas`));
      break;
    case "memory":
      if (ev.action === "recall") console.error(dim(`· memória: ${ev.count} entrada(s) relevante(s)`));
      else if (ev.action === "record") console.error(dim("· memória: episódio gravado"));
      else console.error(dim(`· consolidação: ${ev.count} fato(s) semântico(s) destilado(s)`));
      break;
    case "audit":
      auditLines.push(`[${ev.entry.author}] ${ev.entry.action} → ${ev.entry.target}: ${ev.entry.result}`);
      break;
    case "cost":
      console.error(
        dim(
          `· custo: ${ev.inputTokens} in / ${ev.outputTokens} out tokens · ${
            ev.usd === null ? "$0 (offline)" : "$" + ev.usd.toFixed(4)
          }`,
        ),
      );
      break;
    case "error":
      console.error("\n" + red("Erro: ") + ev.message);
      return 1;
    case "done":
      break;
  }
  return undefined;
}
