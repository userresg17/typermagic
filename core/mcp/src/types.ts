// core/mcp/types.ts
// Subfase 5.6 — Model Context Protocol. Abstrações do cliente: ferramenta,
// resultado, servidor e config. O núcleo trata ferramentas externas como
// cidadão de primeira classe; o transporte (stdio) é um detalhe atrás da
// interface McpServer.

/** JSON Schema do input da ferramenta (passado ao modelo como tool spec). */
export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolResult {
  /** texto do resultado (content do MCP achatado em texto) */
  content: string;
  /** true se a ferramenta sinalizou erro */
  isError?: boolean;
}

/** Um servidor MCP conectado: lista e executa ferramentas. */
export interface McpServer {
  readonly name: string;
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

/** Config de um servidor MCP por stdio (subprocesso). */
export interface StdioServerConfig {
  /** nome lógico (vira o namespace das ferramentas) */
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** diretório de trabalho do subprocesso */
  cwd?: string;
}
