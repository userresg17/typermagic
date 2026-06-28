import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEdits, planEdits } from "@typer/edit";
import { SealRouter } from "../src/seal-router.js";

let root: string;
let testCmd: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-engine-seal-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "soma.js"), "exports.soma = (a,b) => a + b;\n");
  await writeFile(
    join(root, "test.js"),
    `const {soma}=require('./src/soma');if(soma(2,3)!==5){process.exit(1)}`,
  );
  testCmd = [process.execPath, join(root, "test.js")];
});

const goodEdit = `### FILE: src/soma.js
<<<<<<< SEARCH
exports.soma = (a,b) => a + b;
=======
exports.soma = (a,b) => a + b; // comentado, mantém a soma
>>>>>>> REPLACE`;

const badEdit = `### FILE: src/soma.js
<<<<<<< SEARCH
exports.soma = (a,b) => a + b;
=======
exports.soma = (a,b) => a - b;
>>>>>>> REPLACE`;

describe("SealRouter", () => {
  it("classify devolve 'code' para edição e classes externas por reversibilidade", () => {
    const router = new SealRouter({ root, testCommand: testCmd });
    expect(router.classify({ kind: "code" })).toBe("code");
    expect(router.classify({ kind: "external", reversible: true })).toBe("external-reversible");
    expect(router.classify({ kind: "external", reversible: false })).toBe("external-irreversible");
  });

  it("verifyCode mantém a mudança quando a suíte passa (Verificado)", async () => {
    const router = new SealRouter({ root, testCommand: testCmd });
    const plans = await planEdits(root, parseEdits(goodEdit));
    const result = await router.verifyCode(plans);
    expect(result.state).toBe("Verificado");
    expect(await readFile(join(root, "src", "soma.js"), "utf8")).toContain("mantém a soma");
  });

  it("verifyCode reverte quando a suíte falha (Rejeitado, nada no disco)", async () => {
    const original = await readFile(join(root, "src", "soma.js"), "utf8");
    const router = new SealRouter({ root, testCommand: testCmd });
    const plans = await planEdits(root, parseEdits(badEdit));
    const result = await router.verifyCode(plans);
    expect(result.state).toBe("Rejeitado");
    expect(await readFile(join(root, "src", "soma.js"), "utf8")).toBe(original);
  });

  it("toolVerifier devolve {passed} compatível com o ctx.seal do dispatch", async () => {
    const router = new SealRouter({ root, testCommand: testCmd });
    const plans = await planEdits(root, parseEdits(goodEdit));
    const verifier = router.toolVerifier();
    const verdict = await verifier.verify(plans);
    expect(verdict.passed).toBe(true);
  });
});
