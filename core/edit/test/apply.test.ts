import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEdits, writePlan } from "../src/apply.js";
import type { Edit } from "../src/types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-edit-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "a.ts"),
    "export const x = 1;\nexport const y = 2;\n",
  );
});

const edit = (file: string, search: string, replace: string): Edit => ({
  file,
  search,
  replace,
});

describe("planEdits", () => {
  it("planeja modificação sem escrever no disco", async () => {
    const plans = await planEdits(root, [
      edit("src/a.ts", "export const x = 1;", "export const x = 42;"),
    ]);
    expect(plans[0]!.status).toBe("modify");
    expect(plans[0]!.after).toContain("x = 42;");
    // o disco não mudou
    const onDisk = await readFile(join(root, "src", "a.ts"), "utf8");
    expect(onDisk).toContain("x = 1;");
  });

  it("rejeita trecho não encontrado", async () => {
    const plans = await planEdits(root, [
      edit("src/a.ts", "não existe isso", "x"),
    ]);
    expect(plans[0]!.status).toBe("error");
    expect(plans[0]!.error).toMatch(/não encontrado/);
  });

  it("rejeita trecho ambíguo", async () => {
    await writeFile(join(root, "src", "dup.ts"), "foo\nfoo\n");
    const plans = await planEdits(root, [edit("src/dup.ts", "foo", "bar")]);
    expect(plans[0]!.status).toBe("error");
    expect(plans[0]!.error).toMatch(/ambíguo/);
  });

  it("planeja criação de arquivo novo com SEARCH vazio", async () => {
    const plans = await planEdits(root, [
      edit("src/novo.ts", "", "export const z = 3;\n"),
    ]);
    expect(plans[0]!.status).toBe("create");
    expect(plans[0]!.after).toContain("z = 3;");
  });

  it("aplica vários blocos no mesmo arquivo em ordem", async () => {
    const plans = await planEdits(root, [
      edit("src/a.ts", "x = 1;", "x = 10;"),
      edit("src/a.ts", "y = 2;", "y = 20;"),
    ]);
    expect(plans[0]!.edits).toBe(2);
    expect(plans[0]!.after).toContain("x = 10;");
    expect(plans[0]!.after).toContain("y = 20;");
  });
});

describe("writePlan", () => {
  it("escreve só os planos sem erro e devolve os arquivos tocados", async () => {
    const plans = await planEdits(root, [
      edit("src/a.ts", "export const x = 1;", "export const x = 99;"),
      edit("src/novo.ts", "", "novo\n"),
    ]);
    const written = await writePlan(root, plans);
    expect(written.sort()).toEqual(["src/a.ts", "src/novo.ts"]);
    expect(await readFile(join(root, "src", "a.ts"), "utf8")).toContain(
      "x = 99;",
    );
    expect(await readFile(join(root, "src", "novo.ts"), "utf8")).toBe("novo\n");
  });

  it("não escreve nada quando o plano tem erro", async () => {
    const plans = await planEdits(root, [edit("src/a.ts", "inexistente", "z")]);
    const written = await writePlan(root, plans);
    expect(written).toEqual([]);
    expect(await readFile(join(root, "src", "a.ts"), "utf8")).toContain(
      "x = 1;",
    );
  });
});
