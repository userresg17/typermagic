// app/agent-cli/src/repl.ts
// REPL/TUI do agente: sem subcomando, o typer-agent abre um loop interativo. Input
// multilinha (linha terminada em "\" continua), /comandos para ajustar estado, e cada
// entrada vira uma tarefa transmitida pela Engine. Dependency-light: só readline + ANSI.

import { createInterface } from "node:readline/promises";
import { createEngine } from "@typer/engine";
import { isModeName, type ModeName } from "@typer/agent";
import { buildEngineConfig, type Flags } from "./config.js";
import { makeHost } from "./host.js";
import { clearOAuth } from "@typer/router";
import { loginMenu, status as authStatus } from "./commands/auth.js";
import { runAndRender, dim, cyan, bold, green } from "./render.js";

function printHelp(): void {
  console.log(
    [
      dim("comandos:"),
      "  /login                                     entrar (chave de API ou assinatura)",
      "  /logout <anthropic|openai>                 sair de um provider",
      "  /status                                    o que está logado",
      "  /mode <code|ask|architect|debug|gather>    muda o modo",
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
      else if (cmd === "login") {
        await loginMenu((q) => rl.question(q));
      } else if (cmd === "logout") {
        if (args[0]) {
          const ok = await clearOAuth(args[0]);
          console.log(ok ? green(`✓ login de ${args[0]} removido`) : dim(`${args[0]} não tinha login`));
        } else console.log(dim("uso: /logout <anthropic|openai>"));
      } else if (cmd === "status") {
        await authStatus();
      } else if (cmd === "mode") {
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

    // pegou uma palavra solta que é um comando? lembra da barra em vez de virar chat.
    if (["login", "logout", "status", "help", "exit", "quit", "clear"].includes(prompt.toLowerCase())) {
      console.log(dim(`dica: use /${prompt.toLowerCase()} (com barra)`));
      continue;
    }

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
