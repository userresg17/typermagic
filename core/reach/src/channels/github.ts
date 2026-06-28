// core/reach/channels/github.ts
// Canal GitHub: lê repositório (visão + README) ou arquivo. Backends:
//   1) api — REST pública api.github.com (token opcional aumenta o rate limit)
//   2) gh  — fallback via CLI `gh` (se instalado/autenticado)

import type { Backend, Channel, ReachContext, ReachResult } from "../types.js";
import { fetchText } from "../http.js";
import { resolveCred } from "../store.js";

function ghHeaders(ctx: ReachContext): Record<string, string> {
  const token = resolveCred(ctx.config, "github_token");
  return {
    accept: "application/vnd.github+json",
    "user-agent": "typer-reach/1.0",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** owner/repo[/blob|tree/branch/...path] a partir de uma URL ou "owner/repo". */
export function parseRepo(input: string): { owner: string; repo: string; rest: string[] } | null {
  let path = input;
  try {
    if (/^https?:\/\//.test(input)) path = new URL(input).pathname;
  } catch {
    return null;
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/, ""), rest: parts.slice(2) };
}

async function readFile(owner: string, repo: string, branch: string, file: string, ctx: ReachContext): Promise<ReachResult> {
  const r = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`, {
    timeoutMs: ctx.timeoutMs,
  });
  if (r.status >= 400) return { ok: false, error: { code: "not_found", message: `arquivo: status ${r.status}` } };
  return { ok: true, content: `\`\`\`\n${r.text.slice(0, 200_000)}\n\`\`\``, meta: { owner, repo, file } };
}

async function repoOverview(owner: string, repo: string, ctx: ReachContext): Promise<ReachResult> {
  const headers = ghHeaders(ctx);
  const meta = await fetchText(`https://api.github.com/repos/${owner}/${repo}`, { timeoutMs: ctx.timeoutMs, headers });
  if (meta.status >= 400) return { ok: false, error: { code: "not_found", message: `repo: status ${meta.status}` } };
  const j = JSON.parse(meta.text) as {
    full_name: string;
    description?: string;
    stargazers_count?: number;
    language?: string;
    topics?: string[];
  };
  let readme = "";
  const rd = await fetchText(`https://api.github.com/repos/${owner}/${repo}/readme`, { timeoutMs: ctx.timeoutMs, headers });
  if (rd.status < 400) {
    try {
      const c = (JSON.parse(rd.text) as { content?: string }).content ?? "";
      readme = Buffer.from(c, "base64").toString("utf8");
    } catch {
      /* sem readme legível */
    }
  }
  const head = `# ${j.full_name}\n${j.description ?? ""}\n★ ${j.stargazers_count ?? 0} · ${j.language ?? "—"}${
    j.topics?.length ? ` · ${j.topics.join(", ")}` : ""
  }`;
  return { ok: true, content: `${head}\n\n${readme}`.slice(0, 200_000), meta: { owner, repo } };
}

const apiBackend: Backend = {
  name: "api",
  available: () => true,
  run: async (input, ctx) => {
    const p = parseRepo(input);
    if (!p) return { ok: false, error: { code: "bad_url", message: "URL/owner-repo do GitHub inválido" } };
    if (p.rest[0] === "blob" && p.rest.length >= 3) {
      return readFile(p.owner, p.repo, p.rest[1]!, p.rest.slice(2).join("/"), ctx);
    }
    return repoOverview(p.owner, p.repo, ctx);
  },
};

const ghBackend: Backend = {
  name: "gh",
  available: async (ctx) => {
    if (!ctx.runArgv) return false;
    try {
      return (await ctx.runArgv("gh", ["--version"])).code === 0;
    } catch {
      return false;
    }
  },
  run: async (input, ctx) => {
    const p = parseRepo(input);
    if (!p || !ctx.runArgv) return { ok: false, error: { code: "bad_url", message: "inválido" } };
    const r = await ctx.runArgv("gh", ["api", `repos/${p.owner}/${p.repo}`]);
    if (r.code !== 0) return { ok: false, error: { code: "gh_failed", message: r.stderr.slice(0, 200) } };
    try {
      const j = JSON.parse(r.stdout) as { full_name: string; description?: string; stargazers_count?: number };
      return { ok: true, content: `# ${j.full_name}\n${j.description ?? ""}\n★ ${j.stargazers_count ?? 0}` };
    } catch (e) {
      return { ok: false, error: { code: "parse_failed", message: (e as Error).message } };
    }
  },
};

export const githubChannel: Channel = {
  name: "github",
  description: "Ler repositórios e arquivos do GitHub",
  tier: "zero-config",
  backends: [apiBackend, ghBackend],
  matches: (input) => /github\.com/i.test(input),
};
