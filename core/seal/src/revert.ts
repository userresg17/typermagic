// core/seal/revert.ts
// Reverte no disco os planos que o selo escreveu. Modificação restaura o
// conteúdo anterior; criação apaga o arquivo (ele não existia antes). É o que
// garante que uma mudança rejeitada não deixa nada para trás.

import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { FilePlan } from "@typer/edit";

/** Restaura o disco ao estado anterior dos planos dados. Devolve os arquivos
 *  revertidos. */
export async function revertPlans(
  root: string,
  plans: FilePlan[],
): Promise<string[]> {
  const reverted: string[] = [];
  for (const p of plans) {
    if (p.status === "error") continue;
    const abs = resolve(root, p.file);
    if (p.status === "create") {
      await unlink(abs).catch(() => {});
    } else {
      await writeFile(abs, p.before, "utf8");
    }
    reverted.push(p.file);
  }
  return reverted;
}
