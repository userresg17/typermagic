// core/finetune/collect.ts
// Coleta as sequências de edição (dados do fine-tuning). Fonte: o edit-trail
// persistido pela extensão em .typer/edits/trail.jsonl (Estágio 6). Puro p/ o
// parse; a leitura de disco fica em collectFromRoot.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface EditEntry {
  file: string;
  before: string;
  after: string;
  at?: number;
}

/** Parseia o trail.jsonl (uma edição por linha). Linhas inválidas são ignoradas. */
export function parseTrail(jsonl: string): EditEntry[] {
  const out: EditEntry[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<EditEntry>;
      if (typeof o.file === "string" && typeof o.after === "string") {
        out.push({ file: o.file, before: o.before ?? "", after: o.after, ...(o.at !== undefined ? { at: o.at } : {}) });
      }
    } catch {
      /* linha corrompida: ignora */
    }
  }
  return out;
}

export async function collectFromRoot(root: string): Promise<EditEntry[]> {
  const raw = await readFile(join(root, ".typer", "edits", "trail.jsonl"), "utf8").catch(() => "");
  return parseTrail(raw);
}

/** Parseia a saída de `git log -p`: cada hunk vira uma edição (removido→adicionado).
 *  Puro e testável. */
export function parseGitLog(log: string): EditEntry[] {
  const entries: EditEntry[] = [];
  let file = "";
  let before: string[] = [];
  let after: string[] = [];
  const flush = (): void => {
    const b = before.join(" ").trim();
    const a = after.join(" ").trim();
    if (file && (a || b)) entries.push({ file, before: b.slice(0, 200), after: a.slice(0, 200) });
    before = [];
    after = [];
  };
  for (const line of log.split("\n")) {
    if (line.startsWith("diff --git")) {
      flush();
      const m = line.match(/ b\/(.+)$/);
      file = m ? m[1]! : "";
    } else if (line.startsWith("@@")) {
      flush();
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      before.push(line.slice(1));
    }
  }
  flush();
  return entries;
}

/** Extrai sequências de edição do histórico git (dados reais p/ o fine-tune). */
export function collectFromGit(root: string, maxCommits = 80): Promise<EditEntry[]> {
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      ["log", "--no-merges", "-p", `-${maxCommits}`, "--", "*.ts", "*.js", "*.py"],
      { cwd: root },
    );
    let out = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.on("error", () => resolve([]));
    child.on("close", () => resolve(parseGitLog(out)));
  });
}
