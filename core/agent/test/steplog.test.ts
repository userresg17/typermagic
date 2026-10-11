import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logStep, sha256 } from "../src/steplog.js";

describe("steplog — JSONL com rotação", () => {
  it("grava uma linha JSON por passo, com hash do screenshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "typer-steplog-"));
    process.env.TYPER_STEP_LOG = join(dir, "steps.jsonl");
    logStep({ surface: "t", task: "x", agent: "desktop", step: 1, action: "click", target: "1,2", screenshot_sha256: sha256("QUJD"), result: "ok" });
    logStep({ surface: "t", task: "x", agent: "desktop", step: 2, action: "done", result: "fim" });
    const lines = readFileSync(join(dir, "steps.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first.action).toBe("click");
    expect(first.ts).toMatch(/^\d{4}-/);
    expect(first.screenshot_sha256).toHaveLength(16);
  });
  it("rotaciona quando passa do tamanho", () => {
    const dir = mkdtempSync(join(tmpdir(), "typer-steplog-"));
    const p = join(dir, "steps.jsonl");
    process.env.TYPER_STEP_LOG = p;
    process.env.TYPER_STEP_LOG_MAX_MB = "0.0001"; // ~100 bytes
    writeFileSync(p, "x".repeat(200) + "\n");
    logStep({ surface: "t", task: "x", agent: "desktop", step: 1, action: "a", result: "r" });
    expect(existsSync(`${p}.1`)).toBe(true);
    expect(readFileSync(p, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
    delete process.env.TYPER_STEP_LOG_MAX_MB;
  });
});
