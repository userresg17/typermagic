import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cronMatch } from "../src/cron.js";
import { SchedulerDaemon } from "../src/daemon.js";

const AT = { minute: 30, hour: 10, day: 28, month: 6, weekday: 0 };

describe("cronMatch", () => {
  it("* * * * * casa sempre", () => expect(cronMatch("* * * * *", AT)).toBe(true));
  it("campo exato", () => {
    expect(cronMatch("30 10 * * *", AT)).toBe(true);
    expect(cronMatch("31 10 * * *", AT)).toBe(false);
  });
  it("passo */n", () => {
    expect(cronMatch("*/15 * * * *", AT)).toBe(true); // 30 % 15 == 0
    expect(cronMatch("*/7 * * * *", AT)).toBe(false);
  });
  it("range e lista", () => {
    expect(cronMatch("0-30 * * * *", AT)).toBe(true);
    expect(cronMatch("0,15,30 * * * *", AT)).toBe(true);
    expect(cronMatch("0,15,45 * * * *", AT)).toBe(false);
  });
  it("dia-da-semana aceita 0 e 7 como domingo", () => {
    expect(cronMatch("* * * * 0", AT)).toBe(true);
    expect(cronMatch("* * * * 7", AT)).toBe(true);
    expect(cronMatch("* * * * 1", AT)).toBe(false);
  });
  it("expressão malformada não casa", () => expect(cronMatch("* * *", AT)).toBe(false));
});

describe("SchedulerDaemon", () => {
  it("due retorna só as tarefas cujo cron casa agora", async () => {
    const root = await mkdtemp(join(tmpdir(), "typer-sched-"));
    const d = new SchedulerDaemon(
      [
        { name: "a", cron: "* * * * *", prompt: "x" },
        { name: "b", cron: "0 0 * * *", prompt: "y" },
      ],
      { root },
    );
    const at = new Date(2026, 5, 28, 10, 30, 0);
    expect(d.due(at).map((t) => t.name)).toEqual(["a"]);
  });

  it("runDue chama o runner e DEDUPLICA no mesmo minuto", async () => {
    const root = await mkdtemp(join(tmpdir(), "typer-sched-"));
    const calls: string[] = [];
    const d = new SchedulerDaemon([{ name: "a", cron: "* * * * *", prompt: "x" }], {
      root,
      runner: async (t) => {
        calls.push(t.name);
        return { state: "Respondido" };
      },
    });
    const at = new Date(2026, 5, 28, 10, 30, 0);
    await d.runDue(at);
    await d.runDue(at); // mesmo minuto → não roda de novo
    expect(calls).toEqual(["a"]);
  });
});
