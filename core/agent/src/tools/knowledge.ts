// core/agent/tools/families/knowledge.ts → memória, skills e handoff (AGENT_TOOLS
// §7). Liga ao @typer/memory (vault .typer/memory), @typer/skills (.typer/skills)
// e @typer/handoff. Precisam de embedder (ctx.deps ou Fake).

import { join } from "node:path";
import { MarkdownMemory } from "@typer/memory";
import { VerifiedSkillStore } from "@typer/skills";
import { fillHandoff, rePrimeText, type Invariants, type Decision } from "@typer/handoff";
import type { Tool } from "./types.js";
import { nowIso } from "./types.js";
import { embedderFor } from "./helpers.js";

const memoryWrite: Tool = {
  name: "memory_write",
  family: "memória",
  description: "Grava uma entrada de memória (episódica por padrão; semantic=true p/ fato).",
  params: [{ name: "entry", type: "Entry", required: true, description: "{text, semantic?, importance?, source?}" }],
  returns: "id da entrada",
  permission: "meta",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const e = args.entry as { text: string; semantic?: boolean; importance?: number; source?: string };
    if (!e?.text) return { ok: false, error: { code: "invalid_args", message: "entry.text obrigatório" } };
    const mem = new MarkdownMemory({ dir: join(ctx.workspace, ".typer", "memory"), embedder: embedderFor(ctx) });
    await mem.load();
    const input = {
      text: e.text,
      ...(e.importance !== undefined ? { importance: e.importance } : {}),
      ...(e.source !== undefined ? { source: e.source } : {}),
    };
    const written = e.semantic ? await mem.writeSemantic(input) : await mem.writeEpisode(input);
    return written
      ? { ok: true, value: written.id }
      : { ok: false, error: { code: "dedup", message: "entrada duplicada, não gravada" } };
  },
};

export const MEMORY_SKILL = `# memória de longo prazo — você LEMBRA do usuário

Você tem memória PERSISTENTE entre conversas (memory_write / memory_recall). Use sempre:

- SALVE na hora, com memory_write (semantic:true), qualquer FATO DURÁVEL que o usuário
  revelar sobre si: time de futebol, gostos e preferências, tamanhos (roupa/calçado),
  marcas favoritas, pessoas que ele presenteia e os gostos delas, restrições (alergia,
  dieta, religião), datas importantes, e o que ele COMPRA com frequência. Não peça
  permissão (não é ação irreversível) e não repita o que já está salvo.
- APRENDA das COMPRAS (mesmo SEM /setup): quando o usuário, num pedido, der um ENDEREÇO de
  entrega, uma forma de pagamento, ou specs (tamanho/marca/cor), SALVE na memória. Na PRÓXIMA
  compra em que ele NÃO repetir esses dados, RECUPERE e PROPONHA antes de agir — ex.: "Envio pro
  endereço Rua X, 123, e uso o tamanho 42? (sim/não)" (via ask_user) — e só prossiga depois do
  "sim". O usuário NUNCA deve precisar repetir o que já disse uma vez, nem ser obrigado a usar /setup.
- USE o que você sabe: memórias relevantes chegam no contexto; se precisar de algo
  específico, chame memory_recall antes de recomendar/comprar. Personalize como quem
  conhece a pessoa de longa data.
- AUTO-OTIMIZE-SE: ao concluir uma tarefa multi-passo (ex.: reservar/comprar num site),
  salve com memory_write (semantic:true) um PROCEDIMENTO curto — os passos que funcionaram,
  seletores úteis, e o que evitar — com uma chave clara (ex.: "procedimento: reservar hotel
  no booking.com"). ANTES de uma tarefa parecida, recupere com memory_recall. Assim você
  fica mais rápido e esperto a cada vez, sozinho.
- NUNCA invente: só salve o que o usuário disse de fato. Dados sensíveis de pagamento ficam
  no cofre (vault), não na memória.`;

/** Doc da memória p/ o system prompt — SÓ quando as tools de memória estão expostas. */
export function memorySkillSection(tools: { name: string }[]): string {
  return tools.some((t) => t.name === "memory_write") ? MEMORY_SKILL : "";
}

const memoryRecall: Tool = {
  name: "memory_recall",
  family: "memória",
  description: "Recupera entradas de memória relevantes à query.",
  params: [
    { name: "query", type: "string", required: true, description: "o que lembrar" },
    { name: "k", type: "number", required: false, description: "quantas, default 5" },
  ],
  returns: "entradas de memória",
  permission: "read",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const mem = new MarkdownMemory({ dir: join(ctx.workspace, ".typer", "memory"), embedder: embedderFor(ctx) });
    await mem.load();
    const entries = await mem.recall(args.query as string, (args.k as number) ?? 5);
    return { ok: true, value: entries };
  },
};

const skillInduce: Tool = {
  name: "skill_induce",
  family: "skills",
  description: "Destila uma skill candidata de uma tarefa concluída (ainda não selada).",
  params: [{ name: "task", type: "Task", required: true, description: "{name,description,methodology,codeVersion}" }],
  returns: "skill candidata",
  permission: "meta",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const task = args.task as { name: string; description: string; methodology: string; codeVersion: string };
    const store = new VerifiedSkillStore({ dir: join(ctx.workspace, ".typer", "skills"), embedder: embedderFor(ctx) });
    return { ok: true, value: store.induce(task) };
  },
};

const skillInvoke: Tool = {
  name: "skill_invoke",
  family: "skills",
  description: "Busca skills seladas aplicáveis a uma tarefa.",
  params: [
    { name: "task", type: "string", required: true, description: "descrição da tarefa" },
    { name: "k", type: "number", required: false, description: "quantas, default 3" },
  ],
  returns: "skills aplicáveis",
  permission: "meta",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const store = new VerifiedSkillStore({ dir: join(ctx.workspace, ".typer", "skills"), embedder: embedderFor(ctx) });
    await store.load();
    const skills = await store.retrieve(args.task as string, (args.k as number) ?? 3);
    return { ok: true, value: skills };
  },
};

const handoffEmit: Tool = {
  name: "handoff_emit",
  family: "handoff",
  description: "Monta um handoff (Tier 0-3) e devolve o texto de re-priming.",
  params: [
    { name: "section", type: "string", required: true, description: "seção/fase atual" },
    { name: "goal", type: "string", required: false, description: "objetivo ativo" },
    { name: "focus", type: "string", required: false, description: "foco atual" },
    { name: "done", type: "string[]", required: false, description: "concluídos" },
    { name: "decisions", type: "Decision[]", required: false, description: "[{decision,rationale}]" },
  ],
  returns: "{handoff, rePrime}",
  permission: "meta",
  exec: "in_process",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args) => {
    const at = nowIso();
    const tier0: Invariants = {
      locale: "pt-BR",
      hardConstraints: [],
      namingConvention: [],
      forbiddenErrors: [],
      activeGoal: (args.goal as string) ?? "",
      sectionOverlay: [],
      pinned: [],
    };
    const decisions: Decision[] = ((args.decisions as Array<{ decision: string; rationale: string }>) ?? []).map(
      (d) => ({ decision: d.decision, rationale: d.rationale, at }),
    );
    const handoff = fillHandoff(null, {
      section: args.section as string,
      createdAt: at,
      tier0,
      newDecisions: decisions,
      workState: { done: (args.done as string[]) ?? [], inProgress: [], focus: (args.focus as string) ?? "" },
    });
    return { ok: true, value: { handoff, rePrime: rePrimeText(handoff) } };
  },
};

export const knowledgeTools: Tool[] = [
  memoryWrite,
  memoryRecall,
  skillInduce,
  skillInvoke,
  handoffEmit,
];
