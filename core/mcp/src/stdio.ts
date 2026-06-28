// core/mcp/stdio.ts
// Servidor MCP por stdio: sobe o subprocesso e fala JSON-RPC 2.0 (via
// JsonRpcEndpoint). Faz o handshake initialize → notifications/initialized e
// implementa tools/list e tools/call. Achata o content do MCP em texto.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonRpcEndpoint } from "./jsonrpc.js";
import type {
  McpServer,
  StdioServerConfig,
  ToolDef,
  ToolResult,
} from "./types.js";

const PROTOCOL_VERSION = "2024-11-05";

interface ToolsListResult {
  tools?: ToolDef[];
}
interface ToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export class StdioMcpServer implements McpServer {
  readonly name: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rpc: JsonRpcEndpoint | null = null;

  constructor(private readonly config: StdioServerConfig) {
    this.name = config.name;
  }

  /** Sobe o subprocesso e completa o handshake do MCP. */
  async start(): Promise<void> {
    const opts: Parameters<typeof spawn>[2] = {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.config.env ?? {}) },
    };
    if (this.config.cwd) opts.cwd = this.config.cwd;
    const proc = spawn(
      this.config.command,
      this.config.args ?? [],
      opts,
    ) as ChildProcessWithoutNullStreams;
    this.proc = proc;

    const rpc = new JsonRpcEndpoint((line) => proc.stdin.write(line));
    this.rpc = rpc;
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d: string) => rpc.feed(d));
    proc.on("exit", () =>
      rpc.fail(new Error(`Servidor MCP "${this.name}" encerrou.`)),
    );
    proc.on("error", (err) => rpc.fail(err));

    await rpc.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "typer-code", version: "0.0.0" },
    });
    rpc.notify("notifications/initialized");
  }

  async listTools(): Promise<ToolDef[]> {
    const res = await this.rpc!.request<ToolsListResult>("tools/list", {});
    return res.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const res = await this.rpc!.request<ToolCallResult>("tools/call", {
      name,
      arguments: args,
    });
    const content = (res.content ?? [])
      .map((c) => c.text ?? "")
      .join("");
    return { content, isError: res.isError ?? false };
  }

  async close(): Promise<void> {
    this.rpc?.fail(new Error(`Fechando servidor MCP "${this.name}".`));
    this.proc?.kill();
    this.proc = null;
    this.rpc = null;
  }
}
