import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeypair } from "@typer/crypto";
import {
  TrajectoryRecorder,
  verifyTrajectory,
  persistTrajectory,
  loadTrajectories,
} from "../src/recorder.js";
import { trajectoriesToDataset } from "../src/dataset.js";
import type { Trajectory } from "../src/types.js";

describe("TrajectoryRecorder", () => {
  it("grava só os passos relevantes, assina e verifica; adulteração quebra", () => {
    const id = generateKeypair();
    const rec = new TrajectoryRecorder("faça X");
    rec.observe({ type: "tool.call", name: "read_file", args: { path: "a" } });
    rec.observe({ type: "seal", state: "Verificado", attempt: 1 });
    rec.observe({ type: "cost", inputTokens: 10, outputTokens: 5, usd: null });
    rec.observe({ type: "token", text: "ruído fora da trajetória" });
    rec.observe({ type: "done", outcome: { state: "Verificado", attempts: 1 } });
    const traj = rec.build(id);

    expect(traj.steps.length).toBe(2); // tool.call + seal (token/cost/done não viram passo)
    expect(traj.cost?.inputTokens).toBe(10);
    expect((traj.outcome as { state: string }).state).toBe("Verificado");
    expect(traj.signature).toBeTruthy();
    expect(verifyTrajectory(traj, id.publicKeyPem)).toBe(true);
    expect(verifyTrajectory({ ...traj, prompt: "outro prompt" }, id.publicKeyPem)).toBe(false);
  });

  it("persiste e recarrega por id", async () => {
    const root = await mkdtemp(join(tmpdir(), "typer-traj-"));
    const rec = new TrajectoryRecorder("p");
    rec.observe({ type: "done", outcome: { state: "Respondido" } });
    const traj = rec.build();
    await persistTrajectory(root, traj);
    const loaded = await loadTrajectories(root);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.id).toBe(traj.id);
  });
});

describe("dataset a partir de trajetórias", () => {
  it("vira amostras prompt→completion p/ o pipeline de finetune", () => {
    const trajs: Trajectory[] = [
      { id: "x", prompt: "faça X", steps: [{ type: "tool.call", at: 0, data: { name: "t", args: {} } }], outcome: { state: "Respondido" } },
    ];
    const ds = trajectoriesToDataset(trajs, 0);
    expect(ds.train.length).toBe(1);
    expect(ds.train[0]!.prompt).toBe("faça X");
    expect(ds.train[0]!.completion).toContain("tool t");
  });
});
