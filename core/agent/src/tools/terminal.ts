// core/agent/tools/families/terminal.ts → terminal e processo (AGENT_TOOLS.md §7).
// Comandos rodam em subprocess (toolchain do usuário) e pedem aprovação.
// env_inspect NUNCA devolve valor de segredo, só nome e existência (redação §8).

import { spawn, type ChildProcess } from "node:child_process";
import type { Tool } from "./types.js";
import { runSubprocess } from "./executors.js";

interface BgProc {
  proc: ChildProcess;
  output: string;
  done: boolean;
  code: number | null;
}
const bg = new Map<string, BgProc>();
let bgSeq = 0;

const runCommand: Tool = {
  name: "run_command",
  family: "terminal",
  description: "Roda um comando no shell do projeto e devolve a saída.",
  params: [
    { name: "cmd", type: "string", required: true, description: "comando" },
    { name: "cwd", type: "string", required: false, description: "diretório (relativo)" },
  ],
  returns: "{code, stdout, stderr, timedOut}",
  permission: "exec",
  exec: "subprocess",
  tier: "core",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "exec" },
  handler: async (args, ctx) => {
    const cwd = args.cwd ? `${ctx.workspace}/${args.cwd as string}` : ctx.workspace;
    const r = await runSubprocess(args.cmd as string, { cwd });
    return { ok: r.code === 0, value: r, ...(r.code !== 0 ? { error: { code: "nonzero_exit", message: `exit ${r.code}` } } : {}) };
  },
};

const runBackground: Tool = {
  name: "run_background",
  family: "terminal",
  description: "Roda um comando em background; devolve um handle p/ ler/matar.",
  params: [{ name: "cmd", type: "string", required: true, description: "comando" }],
  returns: "{handle}",
  permission: "exec",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "exec" },
  handler: async (args, ctx) => {
    const handle = `bg-${++bgSeq}`;
    const proc = spawn(args.cmd as string, { shell: true, cwd: ctx.workspace });
    const rec: BgProc = { proc, output: "", done: false, code: null };
    proc.stdout?.on("data", (b: Buffer) => (rec.output += b.toString()));
    proc.stderr?.on("data", (b: Buffer) => (rec.output += b.toString()));
    proc.on("close", (code) => {
      rec.done = true;
      rec.code = code ?? -1;
    });
    bg.set(handle, rec);
    return { ok: true, value: { handle } };
  },
};

const readTerminal: Tool = {
  name: "read_terminal",
  family: "terminal",
  description: "Lê a saída acumulada de um processo em background.",
  params: [{ name: "handle", type: "string", required: true, description: "handle do run_background" }],
  returns: "{output, done, code}",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args) => {
    const rec = bg.get(args.handle as string);
    if (!rec) return { ok: false, error: { code: "no_handle", message: "handle desconhecido" } };
    return { ok: true, value: { output: rec.output, done: rec.done, code: rec.code } };
  },
};

const killProcess: Tool = {
  name: "kill_process",
  family: "terminal",
  description: "Mata um processo em background.",
  params: [{ name: "handle", type: "string", required: true, description: "handle" }],
  returns: "ok",
  permission: "exec",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "exec" },
  handler: async (args) => {
    const rec = bg.get(args.handle as string);
    if (!rec) return { ok: false, error: { code: "no_handle", message: "handle desconhecido" } };
    rec.proc.kill("SIGKILL");
    bg.delete(args.handle as string);
    return { ok: true, value: "morto" };
  },
};

const envInspect: Tool = {
  name: "env_inspect",
  family: "terminal",
  description: "Lista variáveis de ambiente por NOME e existência — nunca o valor.",
  params: [{ name: "keys", type: "string[]", required: false, description: "filtrar por nomes" }],
  returns: "[{name, present}]",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args) => {
    const keys = (args.keys as string[] | undefined) ?? Object.keys(process.env);
    // redação obrigatória: só nome + existência
    return { ok: true, value: keys.map((name) => ({ name, present: process.env[name] !== undefined })) };
  },
};

export const terminalTools: Tool[] = [
  runCommand,
  runBackground,
  readTerminal,
  killProcess,
  envInspect,
];
