// core/mcp/fake.ts
// Servidor MCP em memória — para teste e modo offline, na linha do FakeProvider.
// Sem subprocesso: as ferramentas são funções JS locais.

import type { McpServer, ToolDef, ToolResult } from "./types.js";

export interface FakeTool {
  def: ToolDef;
  handler: (
    args: Record<string, unknown>,
  ) => ToolResult | Promise<ToolResult>;
}

export class FakeMcpServer implements McpServer {
  private closed = false;
  constructor(
    public readonly name: string,
    private readonly toolset: FakeTool[],
  ) {}

  async listTools(): Promise<ToolDef[]> {
    return this.toolset.map((t) => t.def);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (this.closed) throw new Error(`Servidor "${this.name}" já fechado.`);
    const tool = this.toolset.find((t) => t.def.name === name);
    if (!tool) {
      return { content: `Ferramenta "${name}" desconhecida.`, isError: true };
    }
    return tool.handler(args);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
