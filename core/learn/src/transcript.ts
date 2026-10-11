// core/learn/transcript.ts
// VTT → segmentos com tempo. Legendas automáticas do YouTube vêm em "rolling text"
// (cada cue repete o fim do anterior) e com tags <c>/<00:00:01.000>; aqui limpamos e
// de-duplicamos para que cada palavra apareça uma vez, no instante em que foi dita.
// Fallback sem legenda: áudio em blocos de 30 s transcritos localmente (tempo grosso).

import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./download.js";
import type { Segment } from "./types.js";

export function parseTimestamp(ts: string): number {
  // 00:01:02.345 | 01:02.345
  const parts = ts.trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return NaN;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return NaN;
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")      // <c>, <00:00:01.000>, <i>…
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\uFEFF/g, "")
    .replace(/\[(Music|Applause|Música|Aplausos)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cues brutos do VTT (sem de-duplicar). */
export function parseVttCues(vtt: string): Segment[] {
  const out: Segment[] = [];
  const blocks = vtt.replace(/\r/g, "").split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim());
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti === -1) continue;
    const [a, bRaw] = lines[ti]!.split("-->");
    const start = parseTimestamp(a!);
    const end = parseTimestamp((bRaw ?? "").trim().split(/\s+/)[0] ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const text = cleanCueText(lines.slice(ti + 1).join(" "));
    if (!text) continue;
    out.push({ start, end, text });
  }
  return out;
}

/** Remove a sobreposição do rolling text: se o cue começa com o fim do texto acumulado,
 *  fica só a parte nova. Cues idênticos consecutivos somem. */
export function dedupeRolling(cues: Segment[]): Segment[] {
  const out: Segment[] = [];
  let tail = "";
  for (const c of cues) {
    let text = c.text;
    if (tail) {
      if (text === tail || tail.endsWith(text)) continue;
      // maior sufixo de `tail` que é prefixo de `text`
      const max = Math.min(tail.length, text.length);
      for (let k = max; k >= 8; k--) {
        if (tail.slice(-k) === text.slice(0, k)) {
          text = text.slice(k).trim();
          break;
        }
      }
      if (!text) continue;
    }
    out.push({ start: c.start, end: c.end, text });
    tail = (tail + " " + text).slice(-400).trim();
  }
  return out;
}

export async function transcriptFromVtt(path: string): Promise<Segment[]> {
  const vtt = await readFile(path, "utf8");
  return dedupeRolling(parseVttCues(vtt));
}

/** Fala no intervalo [from, to], como texto corrido. */
export function speechBetween(segs: Segment[], from: number, to: number): string {
  return segs
    .filter((s) => s.end >= from && s.start <= to)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

/** Transcrição inteira com marcas de tempo a cada bloco de ~`every` segundos. */
export function transcriptText(segs: Segment[], every = 15): string {
  const lines: string[] = [];
  let bucket = -1;
  let acc: string[] = [];
  for (const s of segs) {
    const b = Math.floor(s.start / every);
    if (b !== bucket) {
      if (acc.length) lines.push(`[${fmt(bucket * every)}] ${acc.join(" ")}`);
      bucket = b;
      acc = [];
    }
    acc.push(s.text);
  }
  if (acc.length) lines.push(`[${fmt(bucket * every)}] ${acc.join(" ")}`);
  return lines.join("\n");
}

export function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Fração da duração coberta por fala (p/ aceite: ≥ 0,95 em tutorial falado). */
export function coverage(segs: Segment[], duration: number): number {
  if (!duration) return 0;
  let covered = 0;
  let cursor = 0;
  for (const s of segs) {
    const a = Math.max(s.start, cursor);
    const b = Math.max(s.end, a);
    covered += b - a;
    cursor = b;
  }
  return Math.min(1, covered / duration);
}

/** Fallback sem legenda: corta o áudio em blocos e transcreve cada um com a função
 *  local fornecida (Whisper via @typer/voice). O tempo de cada segmento é o do bloco
 *  (grosso), marcado com `coarse`. */
export async function transcriptFromAudio(
  videoPath: string,
  workDir: string,
  transcribeFile: (wavPath: string) => Promise<string>,
  opts: { blockSeconds?: number; duration: number; signal?: AbortSignal | undefined },
): Promise<Segment[]> {
  const block = opts.blockSeconds ?? 30;
  const dir = join(workDir, "audio");
  await mkdir(dir, { recursive: true });
  const out: Segment[] = [];
  for (let t = 0; t < opts.duration; t += block) {
    const wav = join(dir, `${String(Math.floor(t)).padStart(6, "0")}.wav`);
    const r = await run("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-t", String(block), "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", wav], { signal: opts.signal, timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`ffmpeg (áudio) falhou em t=${t}: ${r.err.trim().slice(-200)}`);
    const text = (await transcribeFile(wav)).trim();
    if (text) out.push({ start: t, end: Math.min(t + block, opts.duration), text, coarse: true });
  }
  return out;
}
