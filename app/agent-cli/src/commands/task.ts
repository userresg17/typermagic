// app/agent-cli/src/commands/task.ts
// run / chat / edit — as três formas de pedir uma tarefa à Engine. run e edit usam
// o modo code (editam via selo); chat usa ask (somente-leitura). Todos transmitem
// EngineEvent pelo render compartilhado.

import { createEngine } from "@typer/engine";
import type { ModeName } from "@typer/agent";
import { buildEngineConfig, rootOf, type Flags } from "../config.js";
import { makeHost } from "../host.js";
import { runAndRender, red } from "../render.js";

async function runTask(flags: Flags, mode: ModeName): Promise<number> {
  const prompt = flags.rest.join(" ").trim();
  if (!prompt) {
    console.error(red('Diga o que fazer. Ex.: typer-agent run "corrija o bug em src/x.ts"'));
    return 2;
  }
  const engine = createEngine(buildEngineConfig(flags, mode), makeHost(flags.yes));
  void rootOf();
  try {
    return await runAndRender(engine, { prompt, files: flags.files });
  } finally {
    await engine.dispose();
  }
}

export const runCmd = (flags: Flags): Promise<number> => runTask(flags, "code");
export const editCmd = (flags: Flags): Promise<number> => runTask(flags, "code");
export const chatCmd = (flags: Flags): Promise<number> => runTask(flags, "ask");
