// Testes do registry MCP + FakeMcpServer — 5.6.
import { describe, it, expect } from "vitest";
import { McpRegistry } from "../src/registry.js";
import { FakeMcpServer, type FakeTool } from "../src/fake.js";

function echoTool(name: string): FakeTool {
  return {
    def: {
      name,
      description: `eco ${name}`,
      inputSchema: { type: "object", properties: { msg: { type: "string" } } },
    },
    handler: (args) => ({ content: String(args.msg ?? "") }),
  };
}

describe("McpRegistry (5.6)", () => {
  it("indexa ferramentas com namespace servidor.tool", async () => {
    const reg = new McpRegistry();
    await reg.add(new FakeMcpServer("fs", [echoTool("read"), echoTool("write")]));
    const names = reg.list().map((t) => t.qualifiedName);
    expect(names).toEqual(["fs.read", "fs.write"]);
    expect(reg.has("fs.read")).toBe(true);
    expect(reg.get("fs.read")?.server).toBe("fs");
  });

  it("evita colisão entre servidores via namespace", async () => {
    const reg = new McpRegistry();
    await reg.add(new FakeMcpServer("a", [echoTool("run")]));
    await reg.add(new FakeMcpServer("b", [echoTool("run")]));
    expect(reg.list().map((t) => t.qualifiedName)).toEqual(["a.run", "b.run"]);
    expect(reg.serverNames()).toEqual(["a", "b"]);
  });

  it("despacha a chamada ao servidor dono da ferramenta", async () => {
    const reg = new McpRegistry();
    await reg.add(new FakeMcpServer("fs", [echoTool("read")]));
    const res = await reg.call("fs.read", { msg: "oi" });
    expect(res).toEqual({ content: "oi" });
  });

  it("erro ao registrar servidor com nome repetido", async () => {
    const reg = new McpRegistry();
    await reg.add(new FakeMcpServer("dup", [echoTool("x")]));
    await expect(reg.add(new FakeMcpServer("dup", []))).rejects.toThrow(/já registrado/);
  });

  it("erro ao chamar ferramenta inexistente", async () => {
    const reg = new McpRegistry();
    await expect(reg.call("nada.aqui", {})).rejects.toThrow(/não encontrada/);
  });

  it("ferramenta desconhecida no servidor retorna isError", async () => {
    const fake = new FakeMcpServer("fs", [echoTool("read")]);
    const res = await fake.callTool("missing", {});
    expect(res.isError).toBe(true);
  });

  it("closeAll fecha servidores e limpa o índice", async () => {
    const reg = new McpRegistry();
    const srv = new FakeMcpServer("fs", [echoTool("read")]);
    await reg.add(srv);
    await reg.closeAll();
    expect(reg.list()).toHaveLength(0);
    expect(reg.serverNames()).toHaveLength(0);
    // servidor fechado recusa chamadas
    await expect(srv.callTool("read", {})).rejects.toThrow(/fechado/);
  });
});
