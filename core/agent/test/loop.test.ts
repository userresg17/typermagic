import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, ChatRequest, Chunk } from "@typer/router";
import { runEditLoop } from "../src/loop.js";

// Provider roteirizado: devolve respostas pré-definidas, uma por chamada de
// chat. Simula o modelo errando na 1ª e acertando na 2ª.
class ScriptedProvider implements Provider {
  readonly id = "scripted";
  private i = 0;
  constructor(private readonly responses: string[]) {}
  async *chat(_req: ChatRequest): AsyncIterable<Chunk> {
    const r = this.responses[Math.min(this.i, this.responses.length - 1)]!;
    this.i++;
    yield { text: r };
  }
  async fim() {
    return "";
  }
  countTokens(t: string) {
    return Math.ceil(t.length / 4);
  }
}

let root: string;
let testCmd: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-agent-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "soma.js"), "exports.soma = (a,b) => a + b;\n");
  await writeFile(
    join(root, "test.js"),
    `const {soma}=require('./src/soma');if(soma(2,3)!==5){console.error('esperado 5, veio',soma(2,3));process.exit(1)}`,
  );
  testCmd = [process.execPath, join(root, "test.js")];
});

const brokenEdit = `### FILE: src/soma.js
<<<<<<< SEARCH
exports.soma = (a,b) => a + b;
=======
exports.soma = (a,b) => a - b;
>>>>>>> REPLACE`;

const fixedEdit = `### FILE: src/soma.js
<<<<<<< SEARCH
exports.soma = (a,b) => a + b;
=======
exports.soma = (a,b) => a + b; // corrigido, mantém a soma
>>>>>>> REPLACE`;

describe("runEditLoop", () => {
  it("corrige na 2ª tentativa um erro causado na 1ª (fecha o loop)", async () => {
    const provider = new ScriptedProvider([brokenEdit, fixedEdit]);
    const outcome = await runEditLoop("", "ajuste a soma", {
      provider,
      model: "x",
      root,
      testCommand: testCmd,
      maxAttempts: 2,
    });
    expect(outcome.state).toBe("Verificado");
    expect(outcome.attempts).toBe(2);
    // a versão correta ficou no disco
    const onDisk = await readFile(join(root, "src", "soma.js"), "utf8");
    expect(onDisk).toContain("a + b");
    expect(onDisk).not.toContain("a - b");
  });

  it("rejeita e reverte quando esgota as tentativas", async () => {
    const original = await readFile(join(root, "src", "soma.js"), "utf8");
    const provider = new ScriptedProvider([brokenEdit, brokenEdit]);
    const outcome = await runEditLoop("", "ajuste a soma", {
      provider,
      model: "x",
      root,
      testCommand: testCmd,
      maxAttempts: 2,
    });
    expect(outcome.state).toBe("Rejeitado");
    expect(outcome.attempts).toBe(2);
    // nada ficou no disco
    expect(await readFile(join(root, "src", "soma.js"), "utf8")).toBe(original);
  });

  it("sela de primeira quando a edição já passa", async () => {
    const provider = new ScriptedProvider([fixedEdit]);
    const outcome = await runEditLoop("", "comente", {
      provider,
      model: "x",
      root,
      testCommand: testCmd,
      maxAttempts: 2,
    });
    expect(outcome.state).toBe("Verificado");
    expect(outcome.attempts).toBe(1);
  });

  it("retorna SemEdicoes quando o modelo não devolve blocos", async () => {
    const provider = new ScriptedProvider(["não tenho blocos para você"]);
    const outcome = await runEditLoop("", "x", {
      provider,
      model: "x",
      root,
      testCommand: testCmd,
    });
    expect(outcome.state).toBe("SemEdicoes");
  });

  it("respeita o cancelamento no beforeSeal", async () => {
    const provider = new ScriptedProvider([fixedEdit]);
    const outcome = await runEditLoop("", "x", {
      provider,
      model: "x",
      root,
      testCommand: testCmd,
      beforeSeal: () => false,
    });
    expect(outcome.state).toBe("Cancelado");
  });
});
