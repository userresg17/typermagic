// core/mcp/index.ts — superfície pública do pacote @typer/mcp (subfase 5.6)

export type {
  JsonSchema,
  ToolDef,
  ToolResult,
  McpServer,
  StdioServerConfig,
} from "./types.js";
export { McpRegistry } from "./registry.js";
export type { RegisteredTool } from "./registry.js";
export { FakeMcpServer } from "./fake.js";
export type { FakeTool } from "./fake.js";
export { StdioMcpServer } from "./stdio.js";
export { JsonRpcEndpoint } from "./jsonrpc.js";
export type { JsonRpcHandlers } from "./jsonrpc.js";
