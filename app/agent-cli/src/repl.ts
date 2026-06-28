// app/agent-cli/src/repl.ts
// REPL/TUI do agente: sem subcomando, o typer-agent abre um loop interativo. Input
// multilinha (linha terminada em "\" continua), /comandos para ajustar estado, e cada
// entrada vira uma tarefa transmitida pela Engine. Dependency-light: só readline + ANSI.

import { createInterface } from "node:readline/promises";
import { createEngine } from "@typer/engine";
import { isModeName, type ModeName } from "@typer/agent";
import { buildEngineConfig, type Flags } from "./config.js";
import { makeHost } from "./host.js";
import { runAndRender, dim, cyan, bold } from "./render.js";

function printHelp(): void {
  console.log(
    [
      dim("comandos:"),
      "  /mode <code|ask|architect|debug|gather>   muda o modo",
      "  /files <a> <b> ...                         arquivos-âncora do contexto",
      "  /provider <anthropic|openai|ollama|fake>   provider BYOK",
      "  /local                                     alterna modelo local (Ollama)",
      "  /clear                                     limpa a tela",
      "  /help                                      esta ajuda",
      "  /exit                                      sai",
      dim("uma linha terminada em \\ continua na próxima."),
    ].join("\n"),
  );
}

export async function repl(flags: Flags): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let mode: ModeName = "ask";
  console.log(bold("TYPER Magic") + dim(" — agente no terminal. /help para ajuda, /exit para sair."));

  let buffer: string[] = [];
  for (;;) {
    const promptStr = buffer.length ? cyan("... ") : cyan(`typer:${mode}> `);
    let line: string;
    try {
      line = await rl.question(promptStr);
    } catch {
      break; // EOF / Ctrl-D
    }

    if (buffer.length === 0 && line.startsWith("/")) {
      const [cmd, ...args] = line.slice(1).trim().split(/\s+/);
      if (cmd === "exit" || cmd === "quit" || cmd === "q") break;
      else if (cmd === "help") printHelp();
      else if (cmd === "mode") {
        if (args[0] && isModeName(args[0])) mode = args[0];
        else console.log(dim("modos: code, ask, architect, debug, gather"));
      } else if (cmd === "files") {
        flags.files = args;
        console.log(dim(`arquivos: ${args.join(", ") || "(nenhum)"}`));
      } else if (cmd === "provider") {
        flags.provider = args[0] ?? null;
        console.log(dim(`provider: ${flags.provider ?? "(auto)"}`));
      } else if (cmd === "local") {
        flags.local = !flags.local;
        console.log(dim(`local: ${flags.local}`));
      } else if (cmd === "clear") {
        console.clear();
      } else {
        console.log(dim(`comando desconhecido: /${cmd} (use /help)`));
      }
      continue;
    }

    if (line.endsWith("\\")) {
      buffer.push(line.slice(0, -1));
      continue;
    }
    buffer.push(line);
    const prompt = buffer.join("\n").trim();
    buffer = [];
    if (!prompt) continue;

    const engine = createEngine(buildEngineConfig(flags, mode), makeHost(flags.yes));
    try {
      await runAndRender(engine, { prompt, files: flags.files });
    } finally {
      await engine.dispose();
    }
    process.stdout.write("\n");
  }

  rl.close();
  return 0;
}
