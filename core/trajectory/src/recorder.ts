// core/trajectory/recorder.ts
// Consome o stream de EngineEvent e monta a trajetória, assinada (Ed25519) e
// reproduzível. token/info/context não entram (ruído); o que importa para auditoria
// e treino sim: tool call/result, plano, selo, aprovação, política, auditoria, custo,
// desfecho. Persiste em .typer/trajectories/<id>.json.

import { createHash } from "node:crypto";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize, signObject, verifyObject, loadOrCreateIdentity, type Identity } from "@typer/crypto";
import type { Trajectory, TrajectoryStep, TrajectoryEvent } from "./types.js";

export class TrajectoryRecorder {
  private readonly steps: TrajectoryStep[] = [];
  private outcome: unknown = null;
  private cost: { inputTokens: number; outputTokens: number; usd: number | null } | undefined;

  constructor(private readonly prompt: string) {}

  observe(ev: TrajectoryEvent): void {
    const at = this.steps.length;
    const push = (data: Record<string, unknown>) => this.steps.push({ type: ev.type, at, data });
    switch (ev.type) {
      case "tool.call":
        push({ name: ev.name, args: ev.args });
        break;
      case "tool.result":
        push({ name: ev.name, ok: ev.ok, preview: ev.preview });
        break;
      case "plan":
        push({
          plans: Array.isArray(ev.plans)
            ? (ev.plans as Array<{ file: string; status: string }>).map((p) => ({ file: p.file, status: p.status }))
            : [],
          attempt: ev.attempt,
        });
        break;
      case "seal":
        push({ state: ev.state, attempt: ev.attempt, ...(ev.reason !== undefined ? { reason: ev.reason } : {}) });
        break;
      case "approval":
        push({ request: ev.request });
        break;
      case "policy":
        push({ tool: ev.tool, decision: ev.decision, ...(ev.reason !== undefined ? { reason: ev.reason } : {}) });
        break;
      case "audit":
        push({ entry: ev.entry });
        break;
      case "error":
        push({ message: ev.message });
        break;
      case "cost":
        this.cost = {
          inputTokens: Number(ev.inputTokens),
          outputTokens: Number(ev.outputTokens),
          usd: (ev.usd as number | null) ?? null,
        };
        break;
      case "done":
        this.outcome = ev.outcome;
        break;
      default:
        break; // token/info/context/memory/handoff: ruído, fora da trajetória
    }
  }

  private base(): Record<string, unknown> {
    return {
      prompt: this.prompt,
      steps: this.steps,
      outcome: this.outcome,
      ...(this.cost ? { cost: this.cost } : {}),
    };
  }

  build(identity?: Identity): Trajectory {
    const base = this.base();
    const hash = createHash("sha256").update(canonicalize(base)).digest("hex").slice(0, 16);
    const traj: Trajectory = {
      id: hash,
      prompt: this.prompt,
      steps: this.steps,
      outcome: this.outcome,
      ...(this.cost ? { cost: this.cost } : {}),
      hash,
    };
    if (identity) {
      traj.signature = signObject(base, identity.privateKeyPem);
      traj.publisher = identity.keyId;
    }
    return traj;
  }
}

/** Verifica a assinatura de uma trajetória (forma canônica do conteúdo). */
export function verifyTrajectory(traj: Trajectory, publicKeyPem: string): boolean {
  if (!traj.signature) return false;
  const base = {
    prompt: traj.prompt,
    steps: traj.steps,
    outcome: traj.outcome,
    ...(traj.cost ? { cost: traj.cost } : {}),
  };
  return verifyObject(base, traj.signature, publicKeyPem);
}

export function trajectoriesDir(root: string): string {
  return join(root, ".typer", "trajectories");
}

export async function persistTrajectory(root: string, traj: Trajectory): Promise<string> {
  const dir = trajectoriesDir(root);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${traj.id}.json`);
  await writeFile(file, JSON.stringify(traj, null, 2), "utf8");
  return file;
}

export async function loadTrajectories(root: string): Promise<Trajectory[]> {
  let files: string[];
  try {
    files = await readdir(trajectoriesDir(root));
  } catch {
    return [];
  }
  const out: Trajectory[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(await readFile(join(trajectoriesDir(root), f), "utf8")) as Trajectory);
    } catch {
      /* arquivo inválido: pula */
    }
  }
  return out;
}

/** Conveniência: monta da lista de eventos, assina com a identidade local e persiste. */
export async function recordTrajectory(
  root: string,
  prompt: string,
  events: TrajectoryEvent[],
  opts: { sign?: boolean } = {},
): Promise<Trajectory> {
  const rec = new TrajectoryRecorder(prompt);
  for (const ev of events) rec.observe(ev);
  const identity = opts.sign === false ? undefined : await loadOrCreateIdentity(join(root, ".typer", "identity"));
  const traj = rec.build(identity);
  await persistTrajectory(root, traj);
  return traj;
}
