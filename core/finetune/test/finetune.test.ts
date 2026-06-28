import { describe, it, expect } from "vitest";
import {
  parseTrail,
  parseGitLog,
  buildSamples,
  splitDataset,
  toOpenAiJsonl,
  toGenericJsonl,
  buildModelfile,
} from "../src/index.js";

describe("parseTrail", () => {
  it("lê edições válidas e ignora lixo", () => {
    const jsonl =
      '{"file":"a.ts","before":"","after":"const x"}\n' +
      "linha quebrada\n" +
      '{"file":"a.ts","after":"x = 1"}\n' +
      '{"naofile":true}\n';
    const e = parseTrail(jsonl);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ file: "a.ts", after: "const x" });
  });
});

describe("parseGitLog", () => {
  it("extrai (removido → adicionado) por hunk do diff", () => {
    const log = [
      "diff --git a/x.ts b/x.ts",
      "index 111..222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 2;",
      " contexto",
    ].join("\n");
    const e = parseGitLog(log);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: "x.ts", before: "const a = 1;", after: "const a = 2;" });
  });

  it("ignora marcadores +++/--- e diff vazio", () => {
    expect(parseGitLog("diff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n")).toHaveLength(0);
  });
});

describe("buildSamples + split", () => {
  const entries = [
    { file: "a.ts", before: "", after: "import x" },
    { file: "a.ts", before: "", after: "const y = 1" },
    { file: "a.ts", before: "", after: "return y" },
  ];
  it("gera (janela anterior → próxima edição)", () => {
    const s = buildSamples(entries);
    expect(s.length).toBe(2); // i=1 e i=2
    expect(s[0]!.completion).toBe("const y = 1");
    expect(s[0]!.prompt).toContain("import x");
    expect(s[1]!.completion).toBe("return y");
  });
  it("split train/val", () => {
    const ds = splitDataset(buildSamples(entries), 0.5);
    expect(ds.train.length + ds.val.length).toBe(2);
  });
});

describe("formatos JSONL", () => {
  const samples = [{ prompt: "p", completion: "c" }];
  it("OpenAI chat (system/user/assistant)", () => {
    const line = JSON.parse(toOpenAiJsonl(samples)) as { messages: Array<{ role: string }> };
    expect(line.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });
  it("genérico {prompt,completion}", () => {
    expect(JSON.parse(toGenericJsonl(samples))).toEqual({ prompt: "p", completion: "c" });
  });
});

describe("buildModelfile (Ollama)", () => {
  it("FROM base + SYSTEM + few-shot", () => {
    const mf = buildModelfile("qwen2.5-coder", [{ prompt: "p1", completion: "c1" }]);
    expect(mf).toContain("FROM qwen2.5-coder");
    expect(mf).toContain("SYSTEM");
    expect(mf).toContain("MESSAGE user");
    expect(mf).toContain("MESSAGE assistant");
  });
});
