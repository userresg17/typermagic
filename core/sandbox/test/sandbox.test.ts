import { describe, it, expect } from "vitest";
import { SubprocessSandbox } from "../src/subprocess.js";
import { detectIsolation } from "../src/detect.js";
import { pickSandbox } from "../src/pick.js";

const sbx = new SubprocessSandbox({ timeoutMs: 5000 });

describe("SubprocessSandbox (isolamento real)", () => {
  it("roda código JS e captura a saída", async () => {
    const out = await sbx.run("process.stdout.write('ola ' + (1 + 2))", "js");
    expect(out).toContain("ola 3");
  });

  it("env LIMPO: não vaza segredos do processo pai", async () => {
    process.env.TYPER_SECRET_LEAK = "vazou";
    try {
      const out = await sbx.run("process.stdout.write(process.env.TYPER_SECRET_LEAK ?? 'NONE')", "js");
      expect(out).toContain("NONE");
      expect(out).not.toContain("vazou");
    } finally {
      delete process.env.TYPER_SECRET_LEAK;
    }
  });

  it("respeita o teto de tempo (mata o processo)", async () => {
    const slow = new SubprocessSandbox({ timeoutMs: 800 });
    const out = await slow.run("while(true){}", "js");
    expect(out).toContain("tempo limite");
  });

  it("linguagem não suportada lança erro claro", async () => {
    await expect(sbx.run("x", "brainfuck")).rejects.toThrow(/não suportada/i);
  });

  it("snapshot/restore não suportados no subprocess (erro honesto)", async () => {
    await expect(sbx.snapshot("x")).rejects.toThrow(/snapshot/i);
    await expect(sbx.restore("x")).rejects.toThrow(/restore/i);
  });

  it("o nível de isolamento é o mais forte disponível", () => {
    const iso = detectIsolation();
    const expected = iso.bwrap ? "bwrap" : iso.unshareNet ? "unshare-net" : "subprocess";
    expect(sbx.level).toBe(expected);
  });
});

describe("pickSandbox", () => {
  it("default é o subprocess (roda em qualquer lugar)", () => {
    const s = pickSandbox();
    expect(["bwrap", "unshare-net", "subprocess"]).toContain(s.level);
  });
});
