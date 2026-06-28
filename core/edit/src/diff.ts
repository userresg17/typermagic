// core/edit/diff.ts
// Render de diff para revisão (diff-first). Algoritmo simples por prefixo e
// sufixo comuns — exato e barato para edições localizadas, sem precisar de um
// Myers completo. A saída lembra um unified diff, com cores opcionais.

import type { FilePlan } from "./types.js";

const CTX = 3;

interface Colors {
  add: string;
  del: string;
  meta: string;
  reset: string;
}
const NO_COLOR: Colors = { add: "", del: "", meta: "", reset: "" };
const ANSI: Colors = {
  add: "\x1b[32m",
  del: "\x1b[31m",
  meta: "\x1b[36m",
  reset: "\x1b[0m",
};

export function renderDiff(
  file: string,
  before: string,
  after: string,
  opts: { color?: boolean } = {},
): string {
  if (before === after) return "";
  const c = opts.color ? ANSI : NO_COLOR;

  const a = before.split("\n");
  const b = after.split("\n");

  // prefixo comum
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  // sufixo comum, sem invadir o prefixo
  let s = 0;
  while (
    s < a.length - p &&
    s < b.length - p &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  ) {
    s++;
  }

  const removed = a.slice(p, a.length - s);
  const added = b.slice(p, b.length - s);

  const ctxStart = Math.max(0, p - CTX);
  const pre = a.slice(ctxStart, p);
  const post = a.slice(a.length - s, a.length - s + CTX);

  const oldCount = pre.length + removed.length + post.length;
  const newCount = pre.length + added.length + post.length;

  const out: string[] = [];
  out.push(`${c.meta}--- a/${file}${c.reset}`);
  out.push(`${c.meta}+++ b/${file}${c.reset}`);
  out.push(
    `${c.meta}@@ -${ctxStart + 1},${oldCount} +${ctxStart + 1},${newCount} @@${c.reset}`,
  );
  for (const l of pre) out.push(` ${l}`);
  for (const l of removed) out.push(`${c.del}-${l}${c.reset}`);
  for (const l of added) out.push(`${c.add}+${l}${c.reset}`);
  for (const l of post) out.push(` ${l}`);
  return out.join("\n");
}

/** Render do diff de um plano, com cabeçalho de status. */
export function renderPlanDiff(
  plan: FilePlan,
  opts: { color?: boolean } = {},
): string {
  const c = opts.color ? ANSI : NO_COLOR;
  if (plan.status === "error") {
    return `${c.del}✗ ${plan.file}: ${plan.error}${c.reset}`;
  }
  const tag = plan.status === "create" ? "novo arquivo" : "modificado";
  const body = renderDiff(plan.file, plan.before, plan.after, opts);
  return `${c.meta}● ${plan.file} (${tag})${c.reset}\n${body}`;
}
