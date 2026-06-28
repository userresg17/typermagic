import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEdits, type Edit } from "@typer/edit";
import { Seal } from "../src/seal.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-seal-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "v.ts"), "export const valor = 1;\n");
});

const edit = (file: string, search: string, replace: string): Edit => ({
  file,
  search,
  replace,
});

// Runner determinístico, cross-platform: o "teste" do projeto passa se o
// arquivo contém a palavra OK, falha caso contrário.
const testCmd = (file: string): string[] => [
  process.execPath,
  "-e",
  `const fs=require('fs');process.exit(fs.readFileSync(${JSON.stringify(
    join(root, file),
  )},'utf8').includes('OK')?0:1)`,
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("Seal.verify", () => {
  it("sela quando a suíte passa e a mudança fica no disco", async () => {
    const plans = await planEdits(root, [
      edit("src/v.ts", "export const valor = 1;", "export const valor = 1; // OK"),
    ]);
    const res = await new Seal().verify(plans, {
      root,
      testCommand: testCmd("src/v.ts"),
    });
    expect(res.state).toBe("Verificado");
    expect(res.passed).toBe(true);
    expect(await readFile(join(root, "src", "v.ts"), "utf8")).toContain("OK");
  });

  it("rejeita e reverte modificação quando a suíte falha", async () => {
    const original = await readFile(join(root, "src", "v.ts"), "utf8");
    const plans = await planEdits(root, [
      edit("src/v.ts", "export const valor = 1;", "export const valor = 999;"),
    ]);
    const res = await new Seal().verify(plans, {
      root,
      testCommand: testCmd("src/v.ts"), // falha: não tem OK
    });
    expect(res.state).toBe("Rejeitado");
    if (res.state === "Rejeitado") {
      expect(res.reverted).toContain("src/v.ts");
      expect(res.reason).toMatch(/exit 1/);
    }
    // o disco voltou ao original
    expect(await readFile(join(root, "src", "v.ts"), "utf8")).toBe(original);
  });

  it("rejeita e apaga arquivo criado quando a suíte falha", async () => {
    const plans = await planEdits(root, [
      edit("src/novo.ts", "", "export const z = 2;\n"), // sem OK -> falha
    ]);
    const res = await new Seal().verify(plans, {
      root,
      testCommand: testCmd("src/novo.ts"),
    });
    expect(res.state).toBe("Rejeitado");
    // o arquivo criado foi apagado na reversão
    expect(await exists(join(root, "src", "novo.ts"))).toBe(false);
  });

  it("rejeita quando o comando de teste não existe", async () => {
    const plans = await planEdits(root, [
      edit("src/v.ts", "export const valor = 1;", "export const valor = 2; // OK"),
    ]);
    const res = await new Seal().verify(plans, {
      root,
      testCommand: ["comando-que-nao-existe-xyz"],
    });
    expect(res.state).toBe("Rejeitado");
    if (res.state === "Rejeitado") {
      expect(res.reason).toMatch(/não pôde ser executado/);
    }
  });

  it("rejeita plano vazio (todos os blocos com erro)", async () => {
    const plans = await planEdits(root, [
      edit("src/v.ts", "trecho inexistente", "x"),
    ]);
    const res = await new Seal().verify(plans, {
      root,
      testCommand: testCmd("src/v.ts"),
    });
    expect(res.state).toBe("Rejeitado");
    if (res.state === "Rejeitado") {
      expect(res.reason).toMatch(/Nada a aplicar/);
    }
  });
});
