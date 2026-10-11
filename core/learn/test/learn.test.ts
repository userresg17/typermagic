import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider } from "@typer/router";
import type { Provider, ChatRequest, Chunk } from "@typer/router";
import { parseSkill, serializeSkill, signSkill, verifySkill } from "@typer/skills";
import { generateKeypair } from "@typer/crypto";
import { parseVttCues, dedupeRolling, speechBetween, transcriptText, coverage, parseTimestamp } from "../src/transcript.js";
import { planTimestamps, dHashFromGray, hamming } from "../src/scenes.js";
import { extractJsonArray, describeFrames } from "../src/describe.js";
import { extractJsonObject, coerceDistilled, toSkill, distill, slugify } from "../src/distill.js";
import { videoIdOf, metaFromInfo } from "../src/download.js";
import { listSkills, summarizeSkill } from "../src/pipeline.js";

const VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.707
\uFEFFSo you chose DaVinci Resolve, good choice!

00:00:02.707 --> 00:00:05.480
In&nbsp;this video, I'll get you up and running with it&nbsp;in 10 minutes.

00:00:05.480 --> 00:00:09.280
Start by downloading the latest&nbsp;
version of the DaVinci Resolve software

00:00:09.280 --> 00:00:12.000
[Music]
`;

/** VTT automático do YouTube: rolling text com tags de tempo e cues repetidos. */
const VTT_ROLLING = `WEBVTT

00:00:01.000 --> 00:00:03.000
click the<00:00:01.500><c> edit</c><00:00:02.000><c> page</c>

00:00:03.000 --> 00:00:03.010
click the edit page

00:00:03.010 --> 00:00:05.000
click the edit page<00:00:03.500><c> and</c><00:00:04.000><c> drag</c>

00:00:05.000 --> 00:00:05.010
click the edit page and drag
`;

describe("transcrição VTT", () => {
  it("parseia timestamps nos dois formatos", () => {
    expect(parseTimestamp("00:01:02.500")).toBeCloseTo(62.5);
    expect(parseTimestamp("01:02.500")).toBeCloseTo(62.5);
    expect(Number.isNaN(parseTimestamp("abc"))).toBe(true);
  });

  it("limpa tags, &nbsp;, BOM e [Music]; descarta cues vazios", () => {
    const cues = parseVttCues(VTT);
    expect(cues).toHaveLength(3);
    expect(cues[0]!.text).toBe("So you chose DaVinci Resolve, good choice!");
    expect(cues[1]!.text).toContain("In this video");
    expect(cues[2]!.text).toBe("Start by downloading the latest version of the DaVinci Resolve software");
  });

  it("de-duplica o rolling text das legendas automáticas", () => {
    const segs = dedupeRolling(parseVttCues(VTT_ROLLING));
    const all = segs.map((s) => s.text).join(" ");
    expect(all).toBe("click the edit page and drag");
    expect(segs).toHaveLength(2);
  });

  it("fala por intervalo, texto com marcas e cobertura", () => {
    const segs = dedupeRolling(parseVttCues(VTT));
    expect(speechBetween(segs, 0, 3)).toContain("good choice");
    expect(speechBetween(segs, 100, 200)).toBe("");
    expect(transcriptText(segs, 15)).toMatch(/^\[0:00\] So you chose/);
    expect(coverage(segs, 9.28)).toBeGreaterThan(0.95);
    expect(coverage(segs, 0)).toBe(0);
  });
});

describe("planejamento de frames", () => {
  it("mescla cortes com amostragem periódica e respeita gap mínimo", () => {
    const plan = planTimestamps([10, 10.5, 40], 60, { maxGap: 6, minGap: 1.5, maxFrames: 150 });
    const ts = plan.map((p) => p.t);
    for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(1.5 - 1e-9);
    for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeLessThanOrEqual(6 + 1e-9);
    expect(plan.filter((p) => p.reason === "scene")).toHaveLength(2); // 10.5 cai no gap mínimo
    expect(ts[ts.length - 1]).toBeGreaterThan(54);
  });

  it("respeita o teto, preferindo cortes de cena", () => {
    const cuts = Array.from({ length: 40 }, (_, i) => i * 10 + 3);
    const plan = planTimestamps(cuts, 400, { maxGap: 2, maxFrames: 50 });
    expect(plan.length).toBeLessThanOrEqual(50);
    expect(plan.filter((p) => p.reason === "scene").length).toBe(40);
    const ts = plan.map((p) => p.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("vídeo de 12 min com cortes realistas fica entre 80 e 150 frames", () => {
    const cuts: number[] = [];
    for (let t = 5; t < 720; t += 7 + (t % 11)) cuts.push(t);
    const plan = planTimestamps(cuts, 720, {});
    expect(plan.length).toBeGreaterThanOrEqual(80);
    expect(plan.length).toBeLessThanOrEqual(150);
  });

  it("dHash: imagens iguais distância 0; gradiente invertido distância alta", () => {
    const a = new Uint8Array(72).map((_, i) => (i % 9) * 20);
    const b = new Uint8Array(72).map((_, i) => 200 - (i % 9) * 20);
    expect(hamming(dHashFromGray(a), dHashFromGray(a))).toBe(0);
    expect(hamming(dHashFromGray(a), dHashFromGray(b))).toBe(64);
  });
});

describe("slug do id", () => {
  it("normaliza acentos e corta em palavra inteira", () => {
    expect(slugify("Editar vídeo: cor & áudio")).toBe("editar-video-cor-audio");
    expect(slugify("davinci resolve editar e exportar um video simples no davinci resolve")).toBe("davinci-resolve-editar-e-exportar-um-video-simples-no");
    expect(slugify("a".repeat(80))).toHaveLength(60);
    expect(slugify("")).toBe("skill");
  });
});

describe("JSON do modelo", () => {
  it("extrai array mesmo cercado de texto e com strings contendo colchetes", () => {
    const txt = 'Aqui vai:\n```json\n[{"t":1,"action":"clica em [Export]"},{"t":2}]\n```';
    expect(extractJsonArray(txt)).toEqual([{ t: 1, action: "clica em [Export]" }, { t: 2 }]);
    expect(extractJsonArray("nada")).toBeNull();
    expect(extractJsonArray("[1,2")).toBeNull();
  });
  it("extrai objeto", () => {
    expect(extractJsonObject('ok {"name":"x","steps":[{"n":1}]} fim')).toEqual({ name: "x", steps: [{ n: 1 }] });
    expect(extractJsonObject("sem json")).toBeNull();
  });
});

describe("destilação → skill candidata", () => {
  const meta = { id: "abc", url: "https://youtu.be/abc", title: "Tutorial X", channel: "Canal", duration: 600, license: "Creative Commons" };

  it("coerce descarta passo sem intenção e arredonda fontes", () => {
    const d = coerceDistilled(
      {
        name: "Exportar vídeo em 1080p",
        description: "Exporta.",
        app: "DaVinci Resolve",
        steps: [
          { intent: "Abrir a página Deliver", how: "clicar na aba Deliver", verify: "painel Render Settings visível", shortcut: "shift+8", sources: [12.345, 13] },
          { how: "sem intenção" },
          { intent: "Adicionar à fila", api: "Project.AddRenderJob", pitfalls: ["esquecer o destino"], sources: [] },
        ],
        pitfalls: ["x"],
        outcome: "arquivo .mp4",
      },
      "",
    );
    expect(d.steps).toHaveLength(2);
    expect(d.steps[0]!.sources).toEqual([12.3, 13]);
    expect(d.steps[1]!.n).toBe(2);
    expect(d.steps[1]!.api).toBe("Project.AddRenderJob");
    expect(d.steps[1]!.sources).toBeUndefined();
  });

  it("toSkill gera candidata GUI que sobrevive ao round-trip SKILL.md e é assinável", () => {
    const d = coerceDistilled(
      { name: "Exportar vídeo", description: "Exporta.", app: "DaVinci Resolve", appVersion: "20", steps: [{ intent: "Abrir Deliver", how: "aba", verify: "ok", sources: [5] }], outcome: "mp4" },
      "",
    );
    const skill = toSkill(d, meta, new Date("2026-10-11T00:00:00Z"));
    expect(skill.id).toBe("davinci-resolve-exportar-video");
    expect(skill.kind).toBe("gui");
    expect(skill.state).toBe("candidate");
    expect(skill.sealed).toBe(false);
    expect(skill.methodology).toContain("AINDA NÃO ensaiada");
    expect(skill.methodology).toContain("[0:05]");
    expect(skill.methodology).toContain("Licença declarada: Creative Commons");

    const back = parseSkill(serializeSkill(skill));
    expect(back).not.toBeNull();
    expect(back!.steps).toEqual(skill.steps);
    expect(back!.sources).toEqual(skill.sources);
    expect(back!.app).toBe("DaVinci Resolve");
    expect(back!.appVersion).toBe("20");
    expect(back!.state).toBe("candidate");
    expect(back!.methodology).toBe(skill.methodology);

    // passos entram na assinatura: adulterar um passo invalida
    const kp = generateKeypair();
    const signed = signSkill(skill, kp);
    expect(verifySkill(signed, kp.publicKeyPem)).toBe(true);
    const tampered = { ...signed, steps: [{ ...signed.steps![0]!, intent: "apagar o projeto" }] };
    expect(verifySkill(tampered, kp.publicKeyPem)).toBe(false);
  });

  it("skill legada (sem campos GUI) continua parseando igual", () => {
    const legacy = "---\nid: s1\nname: Skill X\ndescription: faz X\ncodeVersion: v1\nsealed: true\ncreatedAt: 2026-06-26T12:00:00Z\n---\n\n1. passo\n";
    const s = parseSkill(legacy)!;
    expect(s.kind).toBeUndefined();
    expect(s.steps).toBeUndefined();
    expect(s.state).toBeUndefined();
  });

  it("distill com provider falso: consome transcrição e descrições e produz passos", async () => {
    const reply = JSON.stringify({
      name: "Cortar clipe",
      description: "Corta.",
      app: "DaVinci Resolve",
      appVersion: "",
      prerequisites: ["projeto aberto"],
      steps: [{ n: 1, intent: "Posicionar o cursor", how: "timeline", verify: "linha vermelha", shortcut: "cmd+b", sources: [30] }],
      pitfalls: [],
      outcome: "clipe dividido",
    });
    const seen: ChatRequest[] = [];
    const provider: Provider = {
      id: "stub",
      async *chat(req: ChatRequest): AsyncIterable<Chunk> {
        seen.push(req);
        yield { text: "```json\n" + reply + "\n```", usage: { inputTokens: 100, outputTokens: 50 } };
      },
      fim: async () => "",
      countTokens: (t) => t.length,
    };
    const { distilled, usage } = await distill(
      { meta, segments: [{ start: 28, end: 32, text: "press command B to cut" }], descriptions: [{ t: 30, app: "DaVinci Resolve", panel: "Edit page", action: "cuts clip", uiElements: ["Timeline"], shortcut: "cmd+b" }], appHint: "DaVinci Resolve" },
      { provider, model: "m" },
    );
    expect(distilled.steps[0]!.shortcut).toBe("cmd+b");
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    const prompt = seen[0]!.messages[0]!.content;
    expect(prompt).toContain("press command B to cut");
    expect(prompt).toContain('"panel":"Edit page"');
    expect(seen[0]!.system).toContain("DADOS do tutorial");
  });

  it("distill sem JSON válido falha com erro claro", async () => {
    await expect(distill({ meta, segments: [], descriptions: [] }, { provider: new FakeProvider(), model: "fake" })).rejects.toThrow(/JSON|passo/);
  });
});

describe("descrição por visão com provider falso", () => {
  it("manda imagens em lote com a fala do intervalo e tolera lote com resposta curta", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-"));
    const f1 = join(dir, "a.jpg");
    const f2 = join(dir, "b.jpg");
    await writeFile(f1, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await writeFile(f2, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const seen: ChatRequest[] = [];
    const provider: Provider = {
      id: "stub",
      async *chat(req: ChatRequest): AsyncIterable<Chunk> {
        seen.push(req);
        yield { text: '[{"t":10,"app":"DaVinci Resolve","panel":"Edit","action":"corta","uiElements":["Timeline","Blade"],"shortcut":"cmd+b"}]' };
      },
      fim: async () => "",
      countTokens: (t) => t.length,
    };
    const { descriptions } = await describeFrames(
      [
        { i: 0, t: 10, path: f1, reason: "scene" },
        { i: 1, t: 14, path: f2, reason: "periodic" },
      ],
      [{ start: 9, end: 12, text: "use the blade tool" }],
      { provider, model: "m", batchSize: 5 },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.messages[0]!.images).toHaveLength(2);
    expect(seen[0]!.messages[0]!.images![0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(seen[0]!.messages[0]!.content).toContain("use the blade tool");
    expect(descriptions).toHaveLength(2);
    expect(descriptions[0]!.shortcut).toBe("cmd+b");
    expect(descriptions[1]!.app).toBe("desconhecido"); // 2º frame sem resposta → fallback seguro
    expect(descriptions[1]!.t).toBe(14);
  });
});

describe("download: utilitários puros", () => {
  it("reconhece ids de várias formas de URL", () => {
    expect(videoIdOf("https://www.youtube.com/watch?v=SrJOE2pEp7A&t=1")).toBe("SrJOE2pEp7A");
    expect(videoIdOf("https://youtu.be/SrJOE2pEp7A")).toBe("SrJOE2pEp7A");
    expect(videoIdOf("https://youtube.com/shorts/SrJOE2pEp7A")).toBe("SrJOE2pEp7A");
    expect(videoIdOf("SrJOE2pEp7A")).toBe("SrJOE2pEp7A");
    expect(videoIdOf("https://example.com/x")).toBeNull();
  });
  it("metaFromInfo pega só o necessário", () => {
    const m = metaFromInfo({ id: "x", title: "T", channel: "C", duration: 12, license: "CC" }, "u");
    expect(m).toEqual({ id: "x", url: "u", title: "T", channel: "C", duration: 12, uploadDate: undefined, license: "CC" });
  });
});

describe("listagem de skills", () => {
  it("lista candidatas e seladas pelo frontmatter e resume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    const d = coerceDistilled({ name: "Exportar", description: "Exporta.", app: "App", steps: [{ intent: "a", sources: [1] }] }, "");
    const skill = toSkill(d, { id: "v", url: "u", title: "T", duration: 10 });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, skill.id), { recursive: true });
    await writeFile(join(dir, skill.id, "SKILL.md"), serializeSkill(skill));
    await writeFile(join(dir, ".revoked.json"), "[]");
    const all = await listSkills(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("app-exportar");
    const txt = summarizeSkill(all[0]!);
    expect(txt).toContain("[candidate]");
    expect(txt).toContain("1. a");
    expect(await readFile(join(dir, skill.id, "SKILL.md"), "utf8")).toContain("state: candidate");
  });
});
