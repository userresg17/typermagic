// core/agent/tools/index.ts — superfície da camada de ferramentas (AGENT_TOOLS.md).
// buildDefaultRegistry registra as 50; registryExecutor liga o registry+dispatcher
// ao runToolLoop (expondo o CORE no prompt; lazy descoberto via registry.search).

import type { ToolSpec } from "@typer/router";
import type { Tool, ToolContext } from "./types.js";
import { DefaultToolRegistry, type ToolRegistry } from "./registry.js";
import { dispatch } from "./dispatch.js";
import type { ToolExecutor } from "../tool-loop.js";

import { fileTools } from "./files.js";
import { searchTools } from "./search.js";
import { terminalTools } from "./terminal.js";
import { gitTools } from "./git.js";
import { testSealTools } from "./testseal.js";
import { knowledgeTools } from "./knowledge.js";
import { orchestrationTools } from "./orchestration.js";
import { lspTools } from "./lsp.js";
import { sandboxTools } from "./sandbox.js";
import { webTools } from "./web.js";

export * from "./types.js";
export { DefaultToolRegistry } from "./registry.js";
export type { ToolRegistry } from "./registry.js";
export { dispatch } from "./dispatch.js";
export { runSubprocess, StubMicroVm } from "./executors.js";

/** Todas as 50 ferramentas (core + lazy). */
export const ALL_TOOLS: Tool[] = [
  ...fileTools,
  ...searchTools,
  ...terminalTools,
  ...gitTools,
  ...testSealTools,
  ...knowledgeTools,
  ...orchestrationTools,
  ...lspTools,
  ...sandboxTools,
  ...webTools,
];

/** Registry com as 50 ferramentas registradas. */
export function buildDefaultRegistry(): DefaultToolRegistry {
  const registry = new DefaultToolRegistry();
  for (const tool of ALL_TOOLS) registry.register(tool);
  return registry;
}

function jsonType(t: string): string {
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t.endsWith("[]")) return "array";
  if (t === "string") return "string";
  return "object"; // Range, Pos, Diff, Edit[], Entry, Task, ... (composto)
}

/** Converte um Tool no ToolSpec que o modelo recebe (JSON Schema). */
export function toolSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        tool.params.map((p) => [p.name, { type: jsonType(p.type), description: p.description }]),
      ),
      required: tool.params.filter((p) => p.required).map((p) => p.name),
    },
  };
}

/** Adapta o registry+dispatcher ao ToolExecutor do runToolLoop. Expõe o CORE por
 *  padrão (sempre no prompt); passe `expose` p/ incluir ferramentas lazy
 *  descobertas via registry.search. */
export function registryExecutor(
  registry: ToolRegistry,
  ctx: ToolContext,
  opts: { expose?: Tool[] } = {},
): ToolExecutor {
  const exposed = opts.expose ?? registry.core();
  return {
    tools: () => exposed.map(toolSpec),
    call: async (name, args) => {
      const result = await dispatch(registry, name, args, ctx);
      if (result.ok) {
        return { content: typeof result.value === "string" ? result.value : JSON.stringify(result.value) };
      }
      return { content: result.error?.message ?? "erro desconhecido", isError: true };
    },
  };
}
