// app/scheduler/daemon.ts
// Scheduler daemon — heartbeat (tick a cada minuto) que dispara tarefas cujo cron
// casa, via engine.runTask numa superfície "scheduler". AUTONOMIA SEGURA: approval
// "never", mas o policy gate (F1) NEGA ação irreversível sozinho — autonomia sem
// selo é a falha do OpenClaw. Histórico persistido em .typer/scheduler/history.jsonl.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createEngine, type EngineFeatures, type TaskOutcome } from "@typer/engine";
import { cronMatch, fieldsOf } from "./cron.js";

type ModeName = "code" | "ask" | "architect" | "debug" | "gather";

export interface ScheduledTask {
  name: string;
  /** expressão cron de 5 campos */
  cron: string;
  prompt: string;
  mode?: ModeName;
  provider?: string | null;
  local?: boolean;
  features?: EngineFeatures;
}

export type TaskRunner = (task: ScheduledTask) => Promise<{ state: string }>;

export interface SchedulerOptions {
  root: string;
  /** intervalo do tick (default 60000) */
  intervalMs?: number;
  now?: () => Date;
  /** runner injetável (teste); default = Engine */
  runner?: TaskRunner;
}

export class SchedulerDaemon {
  private readonly root: string;
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly runner: TaskRunner;
  private readonly lastMinute = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tasks: ScheduledTask[],
    opts: SchedulerOptions,
  ) {
    this.root = opts.root;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.now = opts.now ?? (() => new Date());
    this.runner = opts.runner ?? ((t) => this.engineRunner(t));
  }

  private minuteKey(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
  }

  /** Tarefas que devem rodar agora (cron casa e ainda não rodou neste minuto). */
  due(at: Date): ScheduledTask[] {
    const f = fieldsOf(at);
    const mk = this.minuteKey(at);
    return this.tasks.filter((t) => cronMatch(t.cron, f) && this.lastMinute.get(t.name) !== mk);
  }

  /** Roda as tarefas devidas, persiste o histórico, devolve os desfechos. */
  async runDue(at: Date = this.now()): Promise<Array<{ task: string; state: string }>> {
    const out: Array<{ task: string; state: string }> = [];
    const mk = this.minuteKey(at);
    for (const t of this.due(at)) {
      this.lastMinute.set(t.name, mk);
      let state: string;
      try {
        state = (await this.runner(t)).state;
      } catch (e) {
        state = `erro: ${e instanceof Error ? e.message : String(e)}`;
      }
      await this.persist(t, state, at);
      out.push({ task: t.name, state });
    }
    return out;
  }

  private async engineRunner(t: ScheduledTask): Promise<{ state: string }> {
    const engine = createEngine(
      {
        root: this.root,
        surface: "scheduler",
        provider: t.provider ?? null,
        local: t.local ?? false,
        mode: t.mode ?? "ask",
        approval: "never", // autônomo: o policy gate nega ação irreversível
        features: t.features ?? {},
      },
      { approve: () => false },
    );
    let outcome: TaskOutcome = { state: "SemEdicoes" };
    try {
      for await (const ev of engine.runTask({ prompt: t.prompt })) {
        if (ev.type === "done") outcome = ev.outcome;
      }
    } finally {
      await engine.dispose();
    }
    return { state: outcome.state };
  }

  private async persist(task: ScheduledTask, state: string, at: Date): Promise<void> {
    const file = join(this.root, ".typer", "scheduler", "history.jsonl");
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify({ task: task.name, state, at: at.toISOString() }) + "\n", "utf8");
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runDue(this.now()), this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** Lê .typer/schedule.json → lista de tarefas (aceita array ou {tasks:[...]}). */
export async function loadSchedule(root: string): Promise<ScheduledTask[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(root, ".typer", "schedule.json"), "utf8"));
    const tasks = Array.isArray(raw) ? raw : (raw as { tasks?: unknown }).tasks;
    return Array.isArray(tasks) ? (tasks as ScheduledTask[]) : [];
  } catch {
    return [];
  }
}
