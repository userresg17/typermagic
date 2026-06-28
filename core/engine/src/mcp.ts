// core/engine/mcp.ts
// Descoberta e execução de ferramentas MCP. Carrega servidores de
// <root>/.typer/mcp.json, conecta, e: em modo read-only roda o loop de tool-use
// (executa as ferramentas via mcpExecutor); em edição, injeta os specs no contexto
// (descoberta). Portado de app/cli/src/mcp.ts, sem logging.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  McpRegistry,
  StdioMcpServer,
  type StdioServerConfig,
  type RegisteredTool,
} from "@typer/mcp";
import type { ToolExecutor } from "@typer/agent";
import type { ToolSpec } from "@typer/router";

/** Nomes de ferramenta nas APIs (Anthropic/OpenAI) só aceitam [a-zA-Z0-9_-]; o
 *  qualificado do MCP tem ponto ("fs.read"). Sanitiza p/ o modelo e mapeia de volta. */
function sanitizeName(qualified: string): string {
  return qualified.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Adapta o McpRegistry à interface ToolExecutor do loop de tool-use. */
export function mcpExecutor(registry: McpRegistry): ToolExecutor {
  const map = new Map<string, string>(); // sanitizado → qualificado
  const specs: ToolSpec[] = registry.list().map((t) => {
    const name = sanitizeName(t.qualifiedName);
    map.set(name, t.qualifiedName);
    return { name, description: t.def.description, inputSchema: t.def.inputSchema };
  });
  return {
    tools: () => specs,
    call: async (name, args) => {
      const qualified = map.get(name) ?? name;
      const r = await registry.call(qualified, args);
      return { content: r.content, ...(r.isError !== undefined ? { isError: r.isError } : {}) };
    },
  };
}

export function mcpConfigPath(root: string): string {
  return join(root, ".typer", "mcp.json");
}

interface McpConfigFile {
  servers?: StdioServerConfig[];
}

/** Lê .typer/mcp.json → lista de servidores stdio (ou [] se não existe). */
export async function loadMcpConfig(root: string): Promise<StdioServerConfig[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(mcpConfigPath(root), "utf8"));
    const cfg = raw as McpConfigFile;
    return Array.isArray(cfg.servers) ? cfg.servers : [];
  } catch {
    return [];
  }
}

/** Conecta os servidores, registra e devolve o registry + as ferramentas. Erros de
 *  um servidor não derrubam os outros; voltam em `failures` p/ a Engine emitir. */
export async function connectMcp(
  configs: StdioServerConfig[],
): Promise<{ registry: McpRegistry; tools: RegisteredTool[]; failures: string[] }> {
  const registry = new McpRegistry();
  const failures: string[] = [];
  for (const cfg of configs) {
    try {
      const server = new StdioMcpServer(cfg);
      await server.start();
      await registry.add(server);
    } catch (err) {
      failures.push(`${cfg.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { registry, tools: registry.list(), failures };
}

/** Seção de ferramentas MCP p/ injetar no contexto (ou "" se nenhuma). */
export function mcpToolsSection(tools: RegisteredTool[]): string {
  if (tools.length === 0) return "";
  const lines = tools.map((t) => `- ${t.qualifiedName}: ${t.def.description}`);
  return ["## Ferramentas externas disponíveis (MCP)", ...lines].join("\n");
}
