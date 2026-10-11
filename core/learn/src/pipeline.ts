// core/learn/pipeline.ts
// Amarra as etapas: download → transcrição → frames → descrição → destilação → skill
// candidata em <skillsDir>/<id>/SKILL.md. Cada etapa grava seu artefato em
// <workDir>/<videoId>/ e é pulada no resume se o artefato já existe. Progresso vai
// por callback (o gateway manda ao Telegram; a CLI imprime).

import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { Provider } from "@typer/router";
import { serializeSkill, parseSkill, type Skill } from "@typer/skills";
import { download } from "./download.js";
import { transcriptFromVtt, transcriptFromAudio, coverage } from "./transcript.js";
import { extractFrames, existingFrames } from "./scenes.js";
import { describeFrames } from "./describe.js";
import { distill, toSkill } from "./distill.js";
import type { Frame, FrameDescription, LearnOptions, LearnResult, Segment } from "./types.js";

export interface LearnDeps {
  provider: Provider;
  /** transcrição local de um WAV 16 kHz (fallback sem legenda); ausente = erro claro */
  transcribeWav?: (wavPath: string) => Promise<string>;
}

async function exists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function learn(url: string, opts: LearnOptions, deps: LearnDeps): Promise<LearnResult> {
  const say = async (m: string): Promise<void> => {
    await opts.onProgress?.(m);
  };
  const timings: Record<string, number> = {};
  const usage = { inputTokens: 0, outputTokens: 0 };
  const resume = opts.resume ?? true;
  const tick = (): (() => number) => {
    const t0 = Date.now();
    return () => Date.now() - t0;
  };

  // 1) download
  let done = tick();
  await say("⬇️ baixando vídeo e legendas…");
  const dl = await download(url, { workDir: opts.workDir, signal: opts.signal, resume });
  timings.download = done();
  await say(`🎬 "${dl.meta.title}" (${Math.round(dl.meta.duration / 60)} min)${dl.subtitlePath ? ` · legenda ${dl.meta.subtitleLang}` : " · sem legenda"}`);

  // 2) transcrição
  done = tick();
  const segPath = join(dl.dir, "transcript.json");
  let segments = resume ? await readJson<Segment[]>(segPath) : null;
  if (!segments) {
    if (dl.subtitlePath) {
      segments = await transcriptFromVtt(dl.subtitlePath);
    } else if (deps.transcribeWav) {
      await say("🗣️ sem legenda — transcrevendo o áudio localmente (blocos de 30 s)…");
      segments = await transcriptFromAudio(dl.videoPath, dl.dir, deps.transcribeWav, { duration: dl.meta.duration, signal: opts.signal });
    } else {
      throw new Error("vídeo sem legenda e sem transcritor local disponível");
    }
    await writeFile(segPath, JSON.stringify(segments), "utf8");
  }
  timings.transcript = done();
  const cov = coverage(segments, dl.meta.duration);
  await say(`📝 transcrição: ${segments.length} trechos, cobertura ${(cov * 100).toFixed(0)}%`);

  // 3) frames
  done = tick();
  const framesDir = join(dl.dir, "frames");
  const framesPath = join(dl.dir, "frames.json");
  // resume: a lista pós-dedup (frames.json) é a verdade; a pasta tem também os descartados
  let frames: Frame[] = (resume ? await readJson<Frame[]>(framesPath) : null) ?? [];
  if (frames.length === 0 && resume) frames = await existingFrames(framesDir);
  if (frames.length === 0) {
    await say("🎞️ detectando cenas e extraindo frames…");
    frames = await extractFrames(dl.videoPath, dl.meta.duration, framesDir, { maxFrames: opts.maxFrames ?? 150, signal: opts.signal });
  }
  await writeFile(framesPath, JSON.stringify(frames), "utf8");
  timings.frames = done();
  await say(`🖼️ ${frames.length} frames únicos`);

  // 4) descrição por visão
  done = tick();
  const descPath = join(dl.dir, "descriptions.json");
  let descriptions = resume ? await readJson<FrameDescription[]>(descPath) : null;
  if (!descriptions || descriptions.length !== frames.length) {
    await say(`👁️ descrevendo frames com ${opts.visionModel}…`);
    let lastReport = 0;
    const r = await describeFrames(frames, segments, {
      provider: deps.provider,
      model: opts.visionModel,
      batchSize: opts.batchSize ?? 5,
      appHint: opts.appHint,
      signal: opts.signal,
      onBatch: async (d, total) => {
        if (d - lastReport >= 25 || d === total) {
          lastReport = d;
          await say(`👁️ ${d}/${total} frames`);
        }
      },
    });
    descriptions = r.descriptions;
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
    await writeFile(descPath, JSON.stringify(descriptions, null, 1), "utf8");
  }
  timings.describe = done();

  // 5) destilação
  done = tick();
  await say(`🧪 destilando o procedimento com ${opts.distillModel}…`);
  const { distilled, usage: du } = await distill({ meta: dl.meta, segments, descriptions, appHint: opts.appHint }, { provider: deps.provider, model: opts.distillModel, signal: opts.signal, debugPath: join(dl.dir, "distill-raw.txt") });
  usage.inputTokens += du.inputTokens;
  usage.outputTokens += du.outputTokens;
  timings.distill = done();

  // 6) skill candidata
  const skill = toSkill(distilled, dl.meta);
  const skillDir = join(opts.skillsDir, skill.id);
  await mkdir(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  await writeFile(skillPath, serializeSkill(skill), "utf8");
  await writeFile(join(dl.dir, "distilled.json"), JSON.stringify(distilled, null, 1), "utf8");
  await writeFile(join(dl.dir, "learn.json"), JSON.stringify({ url, skillId: skill.id, usage, timings, at: new Date().toISOString() }, null, 1), "utf8");

  return {
    skillId: skill.id,
    skillPath,
    meta: dl.meta,
    frames: frames.length,
    segments: segments.length,
    descriptions: descriptions.length,
    usage,
    timings,
  };
}

/** Lista skills (candidatas e seladas) no diretório, lendo o frontmatter. */
export async function listSkills(skillsDir: string): Promise<Skill[]> {
  const names = (await readdir(skillsDir).catch(() => [] as string[])).filter((n) => !n.startsWith("."));
  const out: Skill[] = [];
  for (const n of names) {
    const raw = await readFile(join(skillsDir, n, "SKILL.md"), "utf8").catch(() => "");
    const s = raw ? parseSkill(raw) : null;
    if (s) out.push(s);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function readSkill(skillsDir: string, id: string): Promise<Skill | null> {
  const p = join(skillsDir, id, "SKILL.md");
  if (!(await exists(p))) return null;
  return parseSkill(await readFile(p, "utf8"));
}

/** Resumo curto p/ Telegram/CLI. */
export function summarizeSkill(s: Skill, maxSteps = 12): string {
  const lines = [
    `📘 ${s.name} [${s.state ?? (s.sealed ? "sealed" : "legacy")}]`,
    `id: ${s.id}${s.app ? ` · app: ${s.app}${s.appVersion ? ` ${s.appVersion}` : ""}` : ""}`,
    s.description,
  ];
  if (s.steps?.length) {
    lines.push("", `Passos (${s.steps.length}):`);
    for (const st of s.steps.slice(0, maxSteps)) lines.push(`${st.n}. ${st.intent}${st.shortcut ? ` (${st.shortcut})` : ""}`);
    if (s.steps.length > maxSteps) lines.push(`… +${s.steps.length - maxSteps}`);
  }
  if (s.lastRehearsal) lines.push("", `Último ensaio: ${s.lastRehearsal.passed ? "✅ passou" : "❌ falhou"} em ${s.lastRehearsal.at}${s.lastRehearsal.reason ? ` — ${s.lastRehearsal.reason}` : ""}`);
  return lines.join("\n");
}
