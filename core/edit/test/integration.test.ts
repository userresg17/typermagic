import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEdits } from "../src/parse.js";
import { planEdits, writePlan } from "../src/apply.js";
import { renderPlanDiff } from "../src/diff.js";

// Reproduz o caminho que a CLI percorre no modo --edit, mas com a resposta do
// modelo "enlatada": parse -> plano -> diff -> escrita. Prova que as peças
// compõem de ponta a ponta sem precisar de rede.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-edit-int-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "calc.ts"),
    "export function soma(a: number, b: number) {\n  return a + b;\n}\n",
  );
});

const MODEL_RESPONSE = `Vou ajustar a função e criar um teste.

### FILE: src/calc.ts
<<<<<<< SEARCH
export function soma(a: number, b: number) {
  return a + b;
}
=======
export function soma(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("entrada inválida");
  return a + b;
}
>>>>>>> REPLACE

### FILE: src/calc.test.ts
<<<<<<< SEARCH
=======
import { soma } from "./calc";
console.assert(soma(1, 2) === 3);
>>>>>>> REPLACE
`;

describe("pipeline de edição (CLI --edit)", () => {
  it("parseia, planeja, renderiza diff e aplica no disco", async () => {
    const edits = parseEdits(MODEL_RESPONSE);
    expect(edits).toHaveLength(2);

    const plans = await planEdits(root, edits);
    const modify = plans.find((p) => p.file === "src/calc.ts")!;
    const create = plans.find((p) => p.file === "src/calc.test.ts")!;
    expect(modify.status).toBe("modify");
    expect(create.status).toBe("create");

    // o diff é revisável e o disco ainda está intacto antes de escrever
    expect(renderPlanDiff(modify)).toContain("+  if (Number.isNaN(a)");
    expect(await readFile(join(root, "src", "calc.ts"), "utf8")).not.toContain(
      "NaN",
    );

    const written = await writePlan(root, plans);
    expect(written.sort()).toEqual(["src/calc.test.ts", "src/calc.ts"]);

    const calc = await readFile(join(root, "src", "calc.ts"), "utf8");
    expect(calc).toContain("): number {");
    expect(calc).toContain("entrada inválida");
    const test = await readFile(join(root, "src", "calc.test.ts"), "utf8");
    expect(test).toContain("soma(1, 2) === 3");
  });
});
