// Integração do StdioMcpServer contra um servidor MCP mock real (subprocesso) — 5.6.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StdioMcpServer } from "../src/stdio.js";
import { McpRegistry } from "../src/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const mock = join(here, "fixtures", "mock-server.mjs");

function mockServer(name = "mock"): StdioMcpServer {
  return new StdioMcpServer({ name, command: process.execPath, args: [mock] });
}

describe("StdioMcpServer (5.6, integração)", () => {
  it("faz handshake, lista e chama ferramenta de um servidor stdio real", async () => {
    const srv = mockServer();
    await srv.start();
    try {
      const tools = await srv.listTools();
      expect(tools.map((t) => t.name)).toEqual(["echo"]);
      const res = await srv.callTool("echo", { text: "oi" });
      expect(res.content).toBe("echo:oi");
      expect(res.isError).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it("integra no registry com namespace e despacha a chamada", async () => {
    const srv = mockServer("mock");
    await srv.start();
    const reg = new McpRegistry();
    try {
      await reg.add(srv);
      expect(reg.list().map((t) => t.qualifiedName)).toEqual(["mock.echo"]);
      const res = await reg.call("mock.echo", { text: "x" });
      expect(res.content).toBe("echo:x");
    } finally {
      await reg.closeAll();
    }
  });
});
