// app/agent-cli/src/commands/reach.ts
// Comando `reach` — olhos na internet pela CLI.
//   reach doctor                 status por canal (qual backend funciona)
//   reach read <url>             lê uma URL → markdown (roteia o canal)
//   reach search <consulta>      busca na web (Exa/DDG)
//   reach video <url>            transcrição de YouTube
//   reach social <url>           lê post/thread (Twitter/Reddit/LinkedIn; web fallback)
//   reach login <plataforma>     guarda cookie/API key (exa|github|twitter|reddit|...)
//   reach install                semeia a allowlist de hosts em .typer/policy.json + doctor

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  loadConfig,
  setCred,
  reachRead,
  reachSearch,
  reachChannel,
  checkAll,
  formatReport,
  REACH_SKILL,
  type ReachContext,
  type ReachResult,
} from "@typer/reach";
import { type Flags, rootOf } from "../config.js";
import { green, red, dim, bold } from "../render.js";

/** runArgv sem shell, p/ os backends que precisam de CLI (yt-dlp, gh). */
function runArgv(file: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e) });
    });
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve({ code: c ?? -1, stdout, stderr });
    });
  });
}

async function ctx(): Promise<ReachContext> {
  return { config: await loadConfig(), runArgv, timeoutMs: 25_000 };
}

function printResult(r: ReachResult): number {
  if (!r.ok) {
    console.error(red(`✗ ${r.error?.code ?? "erro"}: ${r.error?.message ?? "falhou"}`));
    return 1;
  }
  console.error(dim(`[${r.backend ?? "?"}]`));
  console.log(r.content ?? "");
  return 0;
}

// plataforma → chave de credencial no store
const CRED_KEY: Record<string, string> = {
  exa: "exa_api_key",
  github: "github_token",
  twitter: "twitter_cookie",
  x: "twitter_cookie",
  reddit: "reddit_cookie",
  linkedin: "linkedin_cookie",
  openai: "openai_api_key",
  groq: "groq_api_key",
};

// hosts que os canais nativos usam (semeados na allowlist do policy gate)
const REACH_HOSTS = [
  "r.jina.ai",
  "api.github.com",
  "raw.githubusercontent.com",
  "api.exa.ai",
  "html.duckduckgo.com",
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
];

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const a = (await rl.question(question)).trim();
  rl.close();
  return a;
}

async function seedPolicy(): Promise<void> {
  const path = join(rootOf(), ".typer", "policy.json");
  let policy: { network?: { allowHosts?: string[] } } = {};
  try {
    policy = JSON.parse(await readFile(path, "utf8"));
  } catch {
    /* sem policy ainda */
  }
  const hosts = new Set([...(policy.network?.allowHosts ?? []), ...REACH_HOSTS]);
  policy.network = { ...policy.network, allowHosts: [...hosts] };
  await mkdir(join(rootOf(), ".typer"), { recursive: true });
  await writeFile(path, JSON.stringify(policy, null, 2), "utf8");
}

export async function reachCmd(flags: Flags): Promise<number> {
  const [sub, ...rest] = flags.rest;
  const arg = rest.join(" ");

  if (!sub || sub === "doctor") {
    console.log(formatReport(await checkAll(await ctx())));
    return 0;
  }
  if (sub === "skill") {
    console.log(REACH_SKILL);
    return 0;
  }
  if (sub === "read") {
    if (!arg) return usage();
    return printResult(await reachRead(arg, await ctx()));
  }
  if (sub === "search") {
    if (!arg) return usage();
    return printResult(await reachSearch(arg, await ctx()));
  }
  if (sub === "video") {
    if (!arg) return usage();
    return printResult(await reachChannel("youtube", arg, await ctx()));
  }
  if (sub === "social") {
    if (!arg) return usage();
    return printResult(await reachRead(arg, await ctx()));
  }
  if (sub === "login") {
    const platform = rest[0];
    if (!platform) {
      console.error("uso: reach login <exa|github|twitter|reddit|linkedin|...>");
      return 2;
    }
    const key = CRED_KEY[platform] ?? platform;
    const value =
      rest[1] ?? (await ask(`Valor de ${key} (API key ou cookie; cole e Enter): `));
    if (!value) return 2;
    await setCred(key, value);
    console.error(green(`✓ ${key} salvo em ~/.typer/reach/config.json (0600)`));
    return 0;
  }
  if (sub === "install") {
    console.error(bold("reach install — semeando allowlist + checando canais"));
    await seedPolicy();
    console.error(green(`✓ hosts do reach na allowlist de .typer/policy.json`));
    console.log(formatReport(await checkAll(await ctx())));
    console.error(
      dim(
        "dica: 'reach login exa <key>' p/ busca semântica; 'reach login github <token>' p/ rate limit.",
      ),
    );
    return 0;
  }

  return usage();
}

function usage(): number {
  console.error("uso: reach doctor | read <url> | search <q> | video <url> | social <url> | login <plat> | install");
  return 2;
}
