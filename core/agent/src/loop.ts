// core/agent/loop.ts
// O loop fino plan-edit-run-verify-fix. Nada vai ao disco fora do selo. Numa
// rejeição, a saída da suíte volta para o modelo como nova mensagem, e ele
// tenta de novo partindo do conteúdo original (a tentativa anterior foi
// revertida pelo selo). É a forma crua do core/agent do roadmap.

import type { ChatRequest, Message, Provider } from "@typer/router";
import { EDIT_SYSTEM_INSTRUCTION, parseEdits, planEdits } from "@typer/edit";
import { Seal, type SealResult } from "@typer/seal";
import type { AttemptInfo, EditLoopOptions, EditLoopOutcome } from "./types.js";

async function collectChat(
  provider: Provider,
  req: ChatRequest,
): Promise<string> {
  let out = "";
  for await (const chunk of provider.chat(req)) out += chunk.text;
  return out;
}

function feedback(result: SealResult): string {
  const out = result.state === "Rejeitado" ? result.output : "";
  const tail = out.trim().split("\n").slice(-40).join("\n");
  return [
    `A suíte falhou após aplicar suas mudanças, e elas foram revertidas.`,
    `Motivo: ${result.state === "Rejeitado" ? result.reason : ""}`,
    ``,
    `Saída da suíte (fim):`,
    tail,
    ``,
    `Corrija o problema. Responda SOMENTE com blocos SEARCH/REPLACE, partindo do`,
    `conteúdo ORIGINAL do arquivo — a tentativa anterior foi desfeita.`,
  ].join("\n");
}

export async function runEditLoop(
  context: string,
  task: string,
  opts: EditLoopOptions,
): Promise<EditLoopOutcome> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const seal = opts.seal ?? new Seal();

  // Prefixo estável (instrução + contexto) no system, marcado para cache (2.7);
  // só a tarefa e o feedback variam entre tentativas. A instrução base vem do
  // modo (5.2) quando informada; default = editor cru.
  const base = opts.system ?? EDIT_SYSTEM_INSTRUCTION;
  const system = context ? `${base}\n\n${context}` : base;
  const messages: Message[] = [{ role: "user", content: `# Tarefa\n${task}` }];

  let last: SealResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await collectChat(opts.provider, {
      messages,
      model: opts.model,
      maxTokens: 4096,
      system,
      cache: true,
    });

    const edits = parseEdits(response);
    if (edits.length === 0) {
      return { state: "SemEdicoes", attempts: attempt };
    }

    const plans = await planEdits(opts.root, edits);
    const info: AttemptInfo = { attempt, maxAttempts, plans, response };

    // Auditoria (5.5): o agente propôs uma edição.
    const targets = plans.map((p) => p.file).join(", ");
    opts.audit?.record({
      author: "agent",
      action: "edit",
      target: targets || "(nenhum)",
      result: "proposto",
      detail: `tentativa ${attempt}/${maxAttempts}`,
    });

    if (opts.beforeSeal && !(await opts.beforeSeal(info))) {
      opts.audit?.record({
        author: "user",
        action: "seal",
        target: targets,
        result: "cancelado",
      });
      return { state: "Cancelado", attempts: attempt };
    }

    const result = await seal.verify(plans, {
      root: opts.root,
      testCommand: opts.testCommand,
    });
    last = result;
    // Auditoria (5.5): desfecho do selo (autor: agente; alvo: a suíte).
    opts.audit?.record({
      author: "agent",
      action: "seal",
      target: Array.isArray(opts.testCommand)
        ? opts.testCommand.join(" ")
        : opts.testCommand,
      result: result.state === "Verificado" ? "verificado" : "rejeitado",
      ...(result.state === "Rejeitado" ? { detail: result.reason } : {}),
    });
    opts.afterSeal?.(info, result);

    if (result.state === "Verificado") {
      return { state: "Verificado", attempts: attempt, result };
    }

    // rejeitado: devolve o erro e tenta de novo, se ainda há tentativa
    if (attempt < maxAttempts) {
      messages.push({ role: "assistant", content: response });
      messages.push({ role: "user", content: feedback(result) });
    }
  }

  return { state: "Rejeitado", attempts: maxAttempts, result: last! };
}
