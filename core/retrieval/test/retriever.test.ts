import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RipgrepRetriever } from "../src/retriever.js";
import { readContextFile } from "../src/file-context.js";
import { ripgrepAvailable } from "../src/ripgrep.js";

// checado em top-level await para o it.runIf enxergar na coleta
const hasRg = await ripgrepAvailable();
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "typer-ret-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "alvo.ts"),
    "export function somaEspecial(a: number, b: number) {\n  return a + b;\n}\n",
  );
  await writeFile(
    join(root, "src", "outro.ts"),
    "import { somaEspecial } from './alvo';\nconst r = somaEspecial(1, 2);\n",
  );
});

describe("readContextFile", () => {
  it("lê o conteúdo do arquivo alvo", async () => {
    const f = await readContextFile(root, "src/alvo.ts");
    expect(f.path).toBe("src/alvo.ts");
    expect(f.content).toContain("somaEspecial");
    expect(f.truncated).toBe(false);
  });

  it("erra claro quando o arquivo não existe", async () => {
    await expect(readContextFile(root, "nao-existe.ts")).rejects.toThrow(
      /não encontrado/,
    );
  });
});

describe("RipgrepRetriever", () => {
  it("monta contexto com o arquivo aberto", async () => {
    const r = new RipgrepRetriever({
      root,
      files: ["src/alvo.ts"],
      grep: false,
    });
    const ctx = await r.retrieve("o que faz somaEspecial", { maxTokens: 2000 });
    expect(ctx.files).toHaveLength(1);
    expect(ctx.files[0]!.content).toContain("somaEspecial");
  });

  it.runIf(hasRg)(
    "puxa trechos do repo via ripgrep quando disponível",
    async () => {
      const r = new RipgrepRetriever({ root, grep: true });
      const ctx = await r.retrieve("somaEspecial", { maxTokens: 2000 });
      expect(ctx.snippets.length).toBeGreaterThan(0);
      expect(ctx.snippets.some((s) => s.text.includes("somaEspecial"))).toBe(
        true,
      );
    },
  );
});
