// core/agent/tools/families/git.ts → git e versionamento (AGENT_TOOLS.md §7).
// Tudo em subprocess (toolchain do usuário). commit/branch mutam histórico → pedem
// aprovação.

import type { Tool } from "./types.js";
import { runArgv } from "./executors.js";

const gitStatus: Tool = {
  name: "git_status",
  family: "git",
  description: "Estado do working tree (porcelain).",
  params: [],
  returns: "saída do git status",
  permission: "read",
  exec: "subprocess",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (_args, ctx) => {
    const r = await runArgv("git", ["status", "--porcelain=v1", "-b"], { cwd: ctx.workspace });
    return { ok: r.code === 0, value: r.stdout, ...(r.code !== 0 ? { error: { code: "git", message: r.stderr } } : {}) };
  },
};

const gitDiff: Tool = {
  name: "git_diff",
  family: "git",
  description: "Diff do working tree (ou contra um ref).",
  params: [{ name: "ref", type: "string", required: false, description: "ref/commit a comparar" }],
  returns: "diff",
  permission: "read",
  exec: "subprocess",
  tier: "core",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const gitArgs = ["diff", ...(args.ref ? [args.ref as string] : [])];
    const r = await runArgv("git", gitArgs, { cwd: ctx.workspace });
    return { ok: r.code === 0, value: r.stdout, ...(r.code !== 0 ? { error: { code: "git", message: r.stderr } } : {}) };
  },
};

const gitCommit: Tool = {
  name: "git_commit",
  family: "git",
  description: "Faz stage de tudo e commita (muta histórico).",
  params: [{ name: "message", type: "string", required: true, description: "mensagem do commit" }],
  returns: "hash",
  permission: "write",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: false, kind: "vcs" }, // commit muta histórico → irreversível
  handler: async (args, ctx) => {
    const add = await runArgv("git", ["add", "-A"], { cwd: ctx.workspace });
    if (add.code !== 0) return { ok: false, error: { code: "git", message: add.stderr } };
    const r = await runArgv("git", ["commit", "-m", args.message as string], { cwd: ctx.workspace });
    if (r.code !== 0) return { ok: false, error: { code: "git", message: r.stderr || r.stdout } };
    const hash = await runArgv("git", ["rev-parse", "HEAD"], { cwd: ctx.workspace });
    return { ok: true, value: hash.stdout.trim() };
  },
};

const gitBranch: Tool = {
  name: "git_branch",
  family: "git",
  description: "Opera branches: list | create | switch | delete.",
  params: [
    { name: "op", type: "string", required: true, description: "list|create|switch|delete" },
    { name: "name", type: "string", required: false, description: "nome da branch" },
  ],
  returns: "saída",
  permission: "write",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "vcs" }, // branch é reversível (switch/delete)
  handler: async (args, ctx) => {
    const op = args.op as string;
    const name = (args.name as string) ?? "";
    const gitArgs =
      op === "list"
        ? ["branch"]
        : op === "create"
          ? ["switch", "-c", name]
          : op === "switch"
            ? ["switch", name]
            : op === "delete"
              ? ["branch", "-D", name]
              : null;
    if (!gitArgs) return { ok: false, error: { code: "bad_op", message: `op inválida: ${op}` } };
    const r = await runArgv("git", gitArgs, { cwd: ctx.workspace });
    return { ok: r.code === 0, value: r.stdout || r.stderr, ...(r.code !== 0 ? { error: { code: "git", message: r.stderr } } : {}) };
  },
};

const gitBlame: Tool = {
  name: "git_blame",
  family: "git",
  description: "Autoria linha a linha de um arquivo.",
  params: [{ name: "path", type: "string", required: true, description: "arquivo" }],
  returns: "blame",
  permission: "read",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const r = await runArgv("git", ["blame", args.path as string], { cwd: ctx.workspace });
    return { ok: r.code === 0, value: r.stdout, ...(r.code !== 0 ? { error: { code: "git", message: r.stderr } } : {}) };
  },
};

export const gitTools: Tool[] = [gitStatus, gitDiff, gitCommit, gitBranch, gitBlame];
