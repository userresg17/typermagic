// core/mcp/registry.ts
// Agrega ferramentas de vários servidores MCP. Cada ferramenta vira "servidor.tool"
// (namespaced) para evitar colisão entre servidores. O loop do agente consulta o
// registry para o tool spec e despacha as chamadas por nome qualificado.

import type { McpServer, ToolDef, ToolResult } from "./types.js";

export interface RegisteredTool {
  /** nome do servidor de origem */
  server: string;
  /** nome da ferramenta no servidor */
  name: string;
  /** "servidor.tool" — único no registry */
  qualifiedName: string;
  def: ToolDef;
}

export class McpRegistry {
  private readonly servers = new Map<string, McpServer>();
  private readonly tools = new Map<string, RegisteredTool>();

  /** Conecta um servidor e indexa suas ferramentas (namespaced). */
  async add(server: McpServer): Promise<RegisteredTool[]> {
    if (this.servers.has(server.name)) {
      throw new Error(`Servidor MCP "${server.name}" já registrado.`);
    }
    const defs = await server.listTools();
    this.servers.set(server.name, server);
    const added: RegisteredTool[] = [];
    for (const def of defs) {
      const qualifiedName = `${server.name}.${def.name}`;
      const entry: RegisteredTool = {
        server: server.name,
        name: def.name,
        qualifiedName,
        def,
      };
      this.tools.set(qualifiedName, entry);
      added.push(entry);
    }
    return added;
  }

  /** Todas as ferramentas conhecidas, em ordem de inserção. */
  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  get(qualifiedName: string): RegisteredTool | undefined {
    return this.tools.get(qualifiedName);
  }

  has(qualifiedName: string): boolean {
    return this.tools.has(qualifiedName);
  }

  serverNames(): string[] {
    return [...this.servers.keys()];
  }

  /** Despacha a chamada ao servidor dono da ferramenta. */
  async call(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(qualifiedName);
    if (!tool) {
      throw new Error(`Ferramenta MCP "${qualifiedName}" não encontrada.`);
    }
    const server = this.servers.get(tool.server);
    if (!server) {
      throw new Error(`Servidor MCP "${tool.server}" não está conectado.`);
    }
    return server.callTool(tool.name, args);
  }

  /** Fecha todos os servidores (encerra subprocessos). */
  async closeAll(): Promise<void> {
    const closing = [...this.servers.values()].map((s) => s.close());
    await Promise.allSettled(closing);
    this.servers.clear();
    this.tools.clear();
  }
}
