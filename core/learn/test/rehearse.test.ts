import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopSession } from "@typer/agent";
import { FakeEmbedder } from "@typer/index";
import { VerifiedSkillStore, type Skill } from "@typer/skills";
import { rehearse, rehearsalPlan, parseVerdict, stepGoal } from "../src/rehearse.js";
import { toSkill, coerceDistilled } from "../src/distill.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

function fakePlatform(log: string[]): DesktopSession {
  return {
    screenshot: async () => ({ png_base64: PNG, width: 1440, height: 900, scale: 2 }),
    click: async (x, y) => void log.push(`click ${x},${y}`),
    double_click: async () => void log.push("double_click"),
    type: async (t) => void log.push(`type ${t}`),
    key: async (c) => void log.push(`key ${c}`),
    scroll: async () => void log.push("scroll"),
    drag: async () => void log.push("drag"),
    mouse_move: async () => void log.push("move"),
    get_screen_size: async () => ({ width: 1440, height: 900 }),
    frontmost_app: async () => ({ name: "TextEdit", pid: 1 }),
    ax_tree: async () => ({ app: "TextEdit", nodes: [{ id: 1, depth: 0, role: "AXButton", label: "Novo", pos: [10, 10], size: [50, 20], actions: ["Press"], enabled: true }] }),
    ax_act: async (id, action) => void log.push(`ax ${id} ${action}`),
    open_app: async (n) => void log.push(`open ${n}`),
    focus_app: async (n) => void log.push(`focus ${n}`),
  } as unknown as DesktopSession;
}

function aSkill(nSteps = 2, app = "TextEdit"): Skill {
  const d = coerceDistilled(
    {
      name: "Criar documento",
      description: "Cria um documento novo.",
      app,
      steps: Array.from({ length: nSteps }, (_, i) => ({ intent: `passo ${i + 1}`, how: "menu", verify: `estado ${i + 1}`, sources: [i * 10] })),
    },
    app,
  );
  return toSkill(d, { id: "v", url: "u", title: "T", duration: 10 });
}

const savedApps = process.env.TYPER_ALLOWED_APPS;
beforeEach(() => {
  process.env.TYPER_ALLOWED_APPS = "TextEdit";
});
afterEach(() => {
  if (savedApps === undefined) delete process.env.TYPER_ALLOWED_APPS;
  else process.env.TYPER_ALLOWED_APPS = savedApps;
});

/** LLM roteirizado: sub-agente responde done; verificador responde conforme a fila. */
function scriptedLlm(verdicts: boolean[], calls: string[]) {
  return async (system: string, messages: { content: string }[]): Promise<string> => {
    const all = messages.map((m) => m.content).join("\n");
    if (system.includes("verifica se um passo")) {
      calls.push("verify");
      const v = verdicts.shift() ?? true;
      return JSON.stringify({ passed: v, reason: v ? "vi o estado" : "nada mudou" });
    }
    calls.push("agent:" + (all.includes("FALHOU") ? "retry" : "first"));
    return JSON.stringify({ actions: [{ action: "done", success: true, text: "feito" }] });
  };
}

describe("ensaio de skill GUI", () => {
  it("roteiro lista os passos; stepGoal restringe ao passo e carrega a falha anterior", () => {
    const s = aSkill(2);
    const plan = rehearsalPlan(s);
    expect(plan).toContain("2 passos");
    expect(plan).toContain("1. passo 1");
    const g = stepGoal(s, s.steps![1]!, 2, "nada mudou");
    expect(g).toContain("passo 2/2");
    expect(g).toContain("NÃO avance");
    expect(g).toContain("FALHOU: nada mudou");
  });

  it("parseVerdict é rigoroso: sem JSON ou passed≠true → falha", () => {
    expect(parseVerdict('{"passed":true,"reason":"ok"}')).toEqual({ passed: true, reason: "ok" });
    expect(parseVerdict('{"passed":"true"}').passed).toBe(false);
    expect(parseVerdict("sim").passed).toBe(false);
  });

  it("passa: abre o app, roda cada passo, verifica, manda foto por passo", async () => {
    const log: string[] = [];
    const calls: string[] = [];
    const photos: string[] = [];
    const progress: string[] = [];
    const r = await rehearse(aSkill(2), {
      platform: fakePlatform(log), settleMs: 0,
      llm: scriptedLlm([true, true], calls),
      checkpoint: async (_png, cap) => void photos.push(cap),
      onProgress: (m) => void progress.push(m),
    });
    expect(r.passed).toBe(true);
    expect(r.steps).toHaveLength(2);
    expect(r.steps.every((s) => s.passed && s.attempts === 1)).toBe(true);
    expect(log[0]).toBe("open TextEdit");
    expect(calls).toEqual(["agent:first", "verify", "agent:first", "verify"]);
    expect(photos).toHaveLength(2);
    expect(photos[0]).toMatch(/^✅ passo 1/);
    expect(progress.some((m) => m.includes("passo 1/2"))).toBe(true);
  });

  it("falha no passo 1 após 2 tentativas e NÃO roda o passo 2", async () => {
    const log: string[] = [];
    const calls: string[] = [];
    const r = await rehearse(aSkill(2), {
      platform: fakePlatform(log), settleMs: 0,
      llm: scriptedLlm([false, false, true], calls),
      maxAttemptsPerStep: 2,
    });
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/passo 1 após 2 tentativa/);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.attempts).toBe(2);
    expect(calls).toEqual(["agent:first", "verify", "agent:retry", "verify"]);
  });

  it("recupera: 1ª tentativa falha, 2ª passa, segue para o passo 2", async () => {
    const calls: string[] = [];
    const r = await rehearse(aSkill(2), { platform: fakePlatform([]), settleMs: 0, llm: scriptedLlm([false, true, true], calls) });
    expect(r.passed).toBe(true);
    expect(r.steps[0]!.attempts).toBe(2);
    expect(r.steps[1]!.attempts).toBe(1);
  });

  it("app fora da allowlist não roda nada", async () => {
    const log: string[] = [];
    const r = await rehearse(aSkill(1, "DaVinci Resolve"), { platform: fakePlatform(log), settleMs: 0, llm: async () => "{}" });
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/fora da allowlist/);
    expect(log).toHaveLength(0);
  });

  it("checagem final objetiva manda no veredito", async () => {
    const r = await rehearse(aSkill(1), {
      platform: fakePlatform([]), settleMs: 0,
      llm: scriptedLlm([true], []),
      finalCheck: async () => ({ passed: false, reason: "arquivo exportado não existe" }),
    });
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/checagem final falhou: arquivo exportado/);
  });

  it("kill switch (STOP) interrompe antes do passo", async () => {
    const saved = process.env.TYPER_STOP_FILE;
    const dir = await mkdtemp(join(tmpdir(), "stop-"));
    process.env.TYPER_STOP_FILE = join(dir, "STOP");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "STOP"), "");
    try {
      const r = await rehearse(aSkill(1), { platform: fakePlatform([]), settleMs: 0, llm: scriptedLlm([true], []) });
      expect(r.passed).toBe(false);
      expect(r.reason).toMatch(/kill switch/);
    } finally {
      if (saved === undefined) delete process.env.TYPER_STOP_FILE;
      else process.env.TYPER_STOP_FILE = saved;
    }
  });

  it("ensaio aprovado → selo → a skill entra na biblioteca e é recuperável; reprovado não entra", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    const store = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder() });
    const skill = aSkill(1);
    const good = await rehearse(skill, { platform: fakePlatform([]), settleMs: 0, llm: scriptedLlm([true], []) });
    expect(good.passed).toBe(true);
    const sealed = await store.seal(
      { ...skill, state: "sealed", lastRehearsal: { at: good.finishedAt, passed: true, reason: good.reason } },
      { state: "Verificado", passed: true, output: good.reason, durationMs: good.durationMs, applied: [] },
    );
    expect(sealed?.sealed).toBe(true);
    // recarrega do disco: assinatura confere, passos GUI preservados
    const store2 = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder() });
    await store2.load();
    const hits = await store2.retrieve("criar documento", 3);
    expect(hits.map((h) => h.id)).toContain(skill.id);
    expect(hits[0]!.steps).toHaveLength(1);
    expect(hits[0]!.lastRehearsal?.passed).toBe(true);

    const bad = await rehearse(aSkill(1), { platform: fakePlatform([]), settleMs: 0, llm: scriptedLlm([false, false], []) });
    const rejected = await store.seal(skill, { state: "Rejeitado", passed: false, output: bad.reason, durationMs: 1, reverted: [], reason: bad.reason });
    expect(rejected).toBeNull();
  });
});
