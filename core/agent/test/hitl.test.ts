// Testes da subfase 5.5 — human-in-the-loop (auditoria + portão de aprovação).
import { describe, it, expect, vi } from "vitest";
import {
  AuditTrail,
  ApprovalGate,
  isApprovalPolicy,
} from "../src/hitl.js";

describe("AuditTrail (5.5)", () => {
  it("registra entradas com timestamp do relógio injetado", () => {
    let t = 1000;
    const audit = new AuditTrail(() => t);
    audit.record({ author: "agent", action: "edit", target: "a.ts", result: "proposto" });
    t = 2000;
    audit.record({ author: "user", action: "approval", target: "a.ts", result: "approved" });
    const es = audit.entries();
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ ts: 1000, author: "agent", action: "edit" });
    expect(es[1]).toMatchObject({ ts: 2000, author: "user", result: "approved" });
  });

  it("format() gera uma linha por entrada com autor, alvo e resultado", () => {
    const audit = new AuditTrail(() => 0);
    audit.record({ author: "agent", action: "seal", target: "pnpm test", result: "rejeitado", detail: "exit 1" });
    const out = audit.format();
    expect(out).toContain("[agent]");
    expect(out).toContain("seal → pnpm test: rejeitado");
    expect(out).toContain("(exit 1)");
  });

  it("toJSON é uma cópia (não vaza o array interno)", () => {
    const audit = new AuditTrail(() => 0);
    audit.record({ author: "agent", action: "x", target: "y", result: "z" });
    const j = audit.toJSON();
    j.push({ ts: 9, author: "agent", action: "fake", target: "", result: "" });
    expect(audit.entries()).toHaveLength(1);
  });
});

describe("ApprovalGate (5.5)", () => {
  it('política "never" auto-aprova sem perguntar e audita "auto"', async () => {
    const prompt = vi.fn(() => true);
    const audit = new AuditTrail(() => 0);
    const gate = new ApprovalGate("never", prompt, audit);
    const ok = await gate.approve({ action: "seal", target: "a.ts" });
    expect(ok).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(audit.entries()[0]).toMatchObject({ result: "auto" });
  });

  it('política "always" pergunta e propaga a decisão (audita)', async () => {
    const audit = new AuditTrail(() => 0);
    const gateNo = new ApprovalGate("always", () => false, audit);
    expect(await gateNo.approve({ action: "seal", target: "a.ts" })).toBe(false);
    expect(audit.entries()[0]).toMatchObject({ result: "denied" });

    const gateYes = new ApprovalGate("always", () => true, audit);
    expect(await gateYes.approve({ action: "seal", target: "b.ts" })).toBe(true);
    expect(audit.entries()[1]).toMatchObject({ result: "approved" });
  });

  it('política "first-only" pergunta na 1ª e auto-aprova nas seguintes', async () => {
    const prompt = vi.fn(() => true);
    const gate = new ApprovalGate("first-only", prompt);
    expect(await gate.approve({ action: "seal", target: "a", attempt: 1 })).toBe(true);
    expect(await gate.approve({ action: "seal", target: "a", attempt: 2 })).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1); // só na 1ª tentativa
  });

  it("isApprovalPolicy valida nomes", () => {
    expect(isApprovalPolicy("always")).toBe(true);
    expect(isApprovalPolicy("first-only")).toBe(true);
    expect(isApprovalPolicy("nope")).toBe(false);
  });
});
