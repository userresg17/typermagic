import { describe, it, expect } from "vitest";
import {
  FULL_GRANT,
  READONLY_GRANT,
  defaultGrantFor,
  brokerAllows,
} from "../src/capability.js";

const readTool = { name: "read_file", permission: "read" as const, exec: "in_process" as const };
const writeTool = { name: "write_file", permission: "write" as const, exec: "in_process" as const };
const netTool = { name: "web_fetch", permission: "network" as const, exec: "subprocess" as const };

describe("defaultGrantFor", () => {
  it("dá grant cheio para o terminal, editor e tui (paridade com hoje)", () => {
    expect(defaultGrantFor("cli")).toBe(FULL_GRANT);
    expect(defaultGrantFor("tui")).toBe(FULL_GRANT);
    expect(defaultGrantFor("editor")).toBe(FULL_GRANT);
  });

  it("dá o piso somente-leitura para um gateway (remetente desconhecido)", () => {
    expect(defaultGrantFor("gateway:whatsapp")).toEqual(READONLY_GRANT);
  });

  it("dá ao scheduler exec local mas nega microVM e rede livre", () => {
    const g = defaultGrantFor("scheduler");
    expect(g.permissions).toContain("write");
    expect(g.permissions).not.toContain("network");
    expect(g.exec).not.toContain("microvm");
  });
});

describe("brokerAllows", () => {
  it("permite leitura e escrita sob grant cheio", () => {
    expect(brokerAllows(readTool, FULL_GRANT).allowed).toBe(true);
    expect(brokerAllows(writeTool, FULL_GRANT).allowed).toBe(true);
  });

  it("permite leitura, mas NEGA escrita sob grant somente-leitura", () => {
    expect(brokerAllows(readTool, READONLY_GRANT).allowed).toBe(true);
    const verdict = brokerAllows(writeTool, READONLY_GRANT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("permissão");
  });

  it("nega quando o contexto de execução não está no grant", () => {
    // rede até pode estar, mas subprocess não está no grant somente-leitura
    const grant = { permissions: ["read", "network"] as const, exec: ["in_process"] as const };
    const verdict = brokerAllows(netTool, { permissions: [...grant.permissions], exec: [...grant.exec] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("execução");
  });

  it("respeita allow/deny explícitos antes dos eixos", () => {
    const denyWrite = { ...FULL_GRANT, tools: { deny: ["write_file"] } };
    expect(brokerAllows(writeTool, denyWrite).allowed).toBe(false);

    const allowOnlyRead = { ...FULL_GRANT, tools: { allow: ["read_file"] } };
    expect(brokerAllows(readTool, allowOnlyRead).allowed).toBe(true);
    expect(brokerAllows(writeTool, allowOnlyRead).allowed).toBe(false);
  });
});
