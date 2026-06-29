import { describe, it, expect } from "vitest";
import { evaluateExternal, isAutonomous } from "../src/policy.js";

const irrevVcs = { external: true, reversible: false, kind: "vcs" } as const;
const revVcs = { external: true, reversible: true, kind: "vcs" } as const;
const revNet = { external: true, reversible: true, kind: "network" } as const;
const revExec = { external: true, reversible: true, kind: "exec" } as const;
const irrevNet = { external: true, reversible: false, kind: "network" } as const;

describe("isAutonomous", () => {
  it("scheduler/gateway com never são autônomos; cli/editor e first-only não", () => {
    expect(isAutonomous("scheduler", "never")).toBe(true);
    expect(isAutonomous("gateway:telegram", "never")).toBe(true);
    expect(isAutonomous("scheduler", "first-only")).toBe(false);
    expect(isAutonomous("cli", "never")).toBe(false);
    expect(isAutonomous("editor", "never")).toBe(false);
  });
});

describe("evaluateExternal", () => {
  it("irreversível + autônomo → DENY (a regra dura que mata o MoltMatch)", () => {
    const v = evaluateExternal({ toolName: "git_commit", effect: irrevVcs, args: {}, autonomous: true, policy: {} });
    expect(v.decision).toBe("deny");
  });

  it("irreversível + interativo → APPROVE (selo humano)", () => {
    const v = evaluateExternal({ toolName: "git_commit", effect: irrevVcs, args: {}, autonomous: false, policy: {} });
    expect(v.decision).toBe("approve");
  });

  it("browser_submit com summary → APPROVE mostrando o resumo de compra na confirmação", () => {
    const summary = "Voo GRU→POA, assento 14A, R$ 450, cartão •••• 1234";
    const v = evaluateExternal({
      toolName: "browser_submit",
      effect: irrevNet,
      args: { selector: "#pay", summary },
      autonomous: false,
      policy: {},
    });
    expect(v.decision).toBe("approve");
    if (v.decision === "approve") {
      expect(v.reason).toBe(summary);
      expect(v.preview).toBe(summary);
    }
  });

  it("browser_submit irreversível em superfície AUTÔNOMA ainda é negado (regra dura)", () => {
    const v = evaluateExternal({
      toolName: "browser_submit",
      effect: irrevNet,
      args: { selector: "#pay", summary: "compra" },
      autonomous: true,
      policy: {},
    });
    expect(v.decision).toBe("deny");
  });

  it("reversível sem allowlist → ALLOW", () => {
    const v = evaluateExternal({ toolName: "git_branch", effect: revVcs, args: { op: "list" }, autonomous: true, policy: {} });
    expect(v.decision).toBe("allow");
  });

  it("rede fora da allowlist: autônomo NEGA, interativo aprova", () => {
    const policy = { network: { allowHosts: ["api.exemplo.com"] } };
    const auto = evaluateExternal({ toolName: "web_fetch", effect: revNet, args: { url: "https://malicioso.com/x" }, autonomous: true, policy });
    expect(auto.decision).toBe("deny");
    const inter = evaluateExternal({ toolName: "web_fetch", effect: revNet, args: { url: "https://malicioso.com/x" }, autonomous: false, policy });
    expect(inter.decision).toBe("approve");
  });

  it("rede dentro da allowlist → ALLOW com preview do host", () => {
    const policy = { network: { allowHosts: ["api.exemplo.com"] } };
    const v = evaluateExternal({ toolName: "web_fetch", effect: revNet, args: { url: "https://api.exemplo.com/x" }, autonomous: true, policy });
    expect(v.decision).toBe("allow");
    if (v.decision === "allow") expect(v.preview).toContain("api.exemplo.com");
  });

  it("exec fora da allowlist de comandos → autônomo NEGA (cita o binário)", () => {
    const policy = { exec: { allowCommands: ["pnpm", "node"] } };
    const v = evaluateExternal({ toolName: "run_command", effect: revExec, args: { cmd: "rm -rf /" }, autonomous: true, policy });
    expect(v.decision).toBe("deny");
    if (v.decision === "deny") expect(v.reason).toMatch(/rm/);
  });

  it("exec dentro da allowlist → ALLOW", () => {
    const policy = { exec: { allowCommands: ["pnpm"] } };
    const v = evaluateExternal({ toolName: "run_command", effect: revExec, args: { cmd: "pnpm test" }, autonomous: true, policy });
    expect(v.decision).toBe("allow");
  });
});
