#!/usr/bin/env node
// app/agent-cli/src/main.ts
// TYPER Magic — CLI/TUI standalone do agente. Segunda superfície sobre a Engine API,
// separada do editor (prova a fachada com um consumidor que não é o editor). Sem
// subcomando e com TTY → abre o REPL; senão despacha o subcomando.
//
//   typer-agent "corrija o bug em src/x.ts"      atalho p/ `run`
//   typer-agent run --test "pnpm test" "..."     edita via selo (loop)
//   typer-agent chat "o que faz pickModel?"      pergunta (somente-leitura)
//   typer-agent tools [search <q>]               inspeciona as 50 ferramentas
//   typer-agent memory [recall <q>]              grafo/recall da memória v2
//   typer-agent skills <q> | handoff | auth      biblioteca / âncora / BYOK
//   typer-agent                                  REPL interativo

import { parseFlags } from "./config.js";
import { runCmd, editCmd, chatCmd } from "./commands/task.js";
import { toolsCmd } from "./commands/tools.js";
import { memoryCmd } from "./commands/memory.js";
import { skillsCmd } from "./commands/skills.js";
import { handoffCmd } from "./commands/handoff.js";
import { authCmd } from "./commands/auth.js";
import { gatewayCmd } from "./commands/gateway.js";
import { scheduleCmd } from "./commands/schedule.js";
import { trajectoryCmd } from "./commands/trajectory.js";
import { repl } from "./repl.js";
import { dim, bold } from "./render.js";

const HELP = [
  bold("TYPER Magic") + dim(" — agente no terminal (sobre a Engine API)"),
  "",
  "uso: typer-agent [comando] [flags] [prompt]",
  "",
  "comandos:",
  "  run     <prompt>        tarefa do agente (edita; --test ativa o loop com selo)",
  "  edit    <prompt>        idem run, foco em edição (use -f <arquivo>)",
  "  chat    <prompt>        pergunta sobre o código (somente-leitura)",
  "  tools   [search <q>]    lista/busca as 50 ferramentas (permissão/exec)",
  "  memory  [recall <q>]    grafo (ascii) ou recall da memória v2",
  "  skills  <q>             skills verificadas relevantes",
  "  handoff                 âncora de handoff em camadas",
  "  auth    status|set      BYOK (chave por provider)",
  "  gateway telegram|fake   sobe o agente num canal (allowlist + rate-limit)",
  "  schedule list|run|daemon tarefas cron (autonomia gateada pelo policy gate)",
  "  trajectory list|verify|export  trajetórias assinadas (use --record nas tarefas)",
  "  (sem comando)           REPL interativo",
  "",
  "flags: -f/--file  -p/--provider  -m/--model  --local  --mode  --approval",
  "       -t/--test  --semantic --memory --handoff --skills --mcp --no-grep  -y/--yes",
].join("\n");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd) {
    if (process.stdin.isTTY) process.exit(await repl(parseFlags([])));
    console.log(HELP);
    process.exit(0);
  }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const known = new Set([
    "run", "edit", "chat", "tools", "memory", "skills", "handoff", "auth", "gateway", "schedule", "trajectory", "repl",
  ]);
  if (!known.has(cmd)) {
    // 1º token não é comando → atalho: trata tudo como `run <prompt>`
    process.exit(await runCmd(parseFlags(argv)));
  }

  const flags = parseFlags(argv.slice(1));
  switch (cmd) {
    case "run":
      process.exit(await runCmd(flags));
      break;
    case "edit":
      process.exit(await editCmd(flags));
      break;
    case "chat":
      process.exit(await chatCmd(flags));
      break;
    case "tools":
      process.exit(toolsCmd(flags));
      break;
    case "memory":
      process.exit(await memoryCmd(flags));
      break;
    case "skills":
      process.exit(await skillsCmd(flags));
      break;
    case "handoff":
      process.exit(await handoffCmd(flags));
      break;
    case "auth":
      process.exit(await authCmd(flags));
      break;
    case "gateway":
      process.exit(await gatewayCmd(flags));
      break;
    case "schedule":
      process.exit(await scheduleCmd(flags));
      break;
    case "trajectory":
      process.exit(await trajectoryCmd(flags));
      break;
    case "repl":
      process.exit(await repl(flags));
      break;
  }
}

void main();
