// core/edit/apply.ts
// Planeja e aplica as edições. O plano é calculado em memória (diff-first): só
// depois da confirmação o writePlan toca o disco. Match exato; ambiguidade é
// rejeitada em vez de adivinhada, porque editar o lugar errado é pior que falhar.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Edit, FilePlan } from "./types.js";

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}

/** Agrupa edições por arquivo, preservando a ordem de chegada. */
function groupByFile(edits: Edit[]): Map<string, Edit[]> {
  const groups = new Map<string, Edit[]>();
  for (const e of edits) {
    const arr = groups.get(e.file) ?? [];
    arr.push(e);
    groups.set(e.file, arr);
  }
  return groups;
}

function planOneFile(
  file: string,
  original: string | null,
  edits: Edit[],
): FilePlan {
  const before = original ?? "";
  let working = before;
  let applied = 0;

  for (const e of edits) {
    if (e.search.length === 0) {
      // SEARCH vazio: só cria/preenche arquivo novo ou vazio
      if (working.trim() !== "") {
        return {
          file,
          before,
          after: before,
          status: "error",
          edits: applied,
          error: "SEARCH vazio só vale para arquivo novo ou vazio.",
        };
      }
      working = e.replace;
      applied++;
      continue;
    }

    const n = countOccurrences(working, e.search);
    if (n === 0) {
      return {
        file,
        before,
        after: before,
        status: "error",
        edits: applied,
        error: "Trecho do SEARCH não encontrado no arquivo.",
      };
    }
    if (n > 1) {
      return {
        file,
        before,
        after: before,
        status: "error",
        edits: applied,
        error: `Trecho ambíguo: ${n} ocorrências. Inclua mais contexto no SEARCH.`,
      };
    }
    working = working.replace(e.search, e.replace);
    applied++;
  }

  return {
    file,
    before,
    after: working,
    status: original === null ? "create" : "modify",
    edits: applied,
  };
}

/** Calcula o plano para todas as edições, sem escrever no disco. */
export async function planEdits(
  root: string,
  edits: Edit[],
): Promise<FilePlan[]> {
  const groups = groupByFile(edits);
  const plans: FilePlan[] = [];
  for (const [file, group] of groups) {
    const abs = resolve(root, file);
    const original = await readOrNull(abs);
    plans.push(planOneFile(file, original, group));
  }
  return plans;
}

/** Escreve no disco os planos sem erro. Cria diretórios pais quando preciso. */
export async function writePlan(
  root: string,
  plans: FilePlan[],
): Promise<string[]> {
  const written: string[] = [];
  for (const p of plans) {
    if (p.status === "error") continue;
    if (p.after === p.before && p.status !== "create") continue;
    const abs = resolve(root, p.file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, p.after, "utf8");
    written.push(p.file);
  }
  return written;
}
