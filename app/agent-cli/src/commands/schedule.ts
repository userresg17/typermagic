// app/agent-cli/src/commands/schedule.ts
// schedule list | run | daemon. As tarefas vêm de .typer/schedule.json (cron +
// prompt). `run` dispara o que está devido agora; `daemon` fica de pé (tick 60s).
// Autonomia segura: tudo roda na superfície "scheduler" e o policy gate nega ação
// irreversível sozinho.

import { SchedulerDaemon, loadSchedule } from "@typer/scheduler";
import { rootOf, type Flags } from "../config.js";
import { dim, green, red } from "../render.js";

export async function scheduleCmd(flags: Flags): Promise<number> {
  const sub = flags.rest[0] ?? "list";
  const root = rootOf();
  const tasks = await loadSchedule(root);

  if (sub === "list") {
    if (tasks.length === 0) {
      console.log(dim("· nenhuma tarefa em .typer/schedule.json"));
      return 0;
    }
    for (const t of tasks) {
      console.log(`• ${t.name}  ${dim(t.cron)}  ${t.prompt.replace(/\n+/g, " ").slice(0, 60)}`);
    }
    return 0;
  }

  if (sub === "run") {
    const d = new SchedulerDaemon(tasks, { root });
    const res = await d.runDue(new Date());
    if (res.length === 0) {
      console.log(dim("· nenhuma tarefa devida agora"));
      return 0;
    }
    for (const r of res) console.log(`${green("✓")} ${r.task} → ${r.state}`);
    return 0;
  }

  if (sub === "daemon") {
    const d = new SchedulerDaemon(tasks, { root });
    console.error(green("✓ scheduler no ar") + dim(` — ${tasks.length} tarefa(s), tick 60s. Ctrl-C para sair.`));
    d.start();
    await new Promise<void>(() => {}); // bloqueia
    return 0;
  }

  console.error(red("uso: schedule list | run | daemon"));
  return 2;
}
