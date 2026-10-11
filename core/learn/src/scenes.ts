// core/learn/scenes.ts
// Escolhe os instantes que valem um frame: cortes de cena (ffmpeg `scene`) mais uma
// amostragem periódica para não perder trechos longos sem corte (menu aberto por
// 40 s). Depois extrai JPEGs a 1280px e descarta quase-iguais por dHash — tutorial
// de tela tem muito frame idêntico (instrutor falando sobre a mesma janela).

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./download.js";
import type { Frame } from "./types.js";

export interface SceneOptions {
  /** sensibilidade do detector (0–1; 0,25 pega troca de painel, não só corte duro) */
  threshold?: number;
  /** gap máximo sem frame (s) */
  maxGap?: number;
  /** distância mínima entre frames (s) */
  minGap?: number;
  /** teto de frames */
  maxFrames?: number;
  /** largura do JPEG */
  width?: number;
  signal?: AbortSignal | undefined;
  /** concorrência na extração */
  concurrency?: number;
}

/** Instantes de corte de cena, via `select='gt(scene,T)',showinfo`. */
export async function detectScenes(videoPath: string, threshold = 0.25, signal?: AbortSignal): Promise<number[]> {
  const r = await run(
    "ffmpeg",
    ["-v", "info", "-i", videoPath, "-vf", `select='gt(scene,${threshold})',showinfo`, "-vsync", "vfr", "-f", "null", "-"],
    { signal, timeoutMs: 20 * 60_000 },
  );
  // showinfo escreve em stderr: "... pts_time:12.345 ..."
  const times = [...r.err.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  return times.filter((t) => Number.isFinite(t));
}

/** Mescla cortes + periódicos, aplica gap mínimo e teto (afinando uniformemente). Puro, testável. */
export function planTimestamps(
  sceneCuts: number[],
  duration: number,
  opts: { maxGap?: number; minGap?: number; maxFrames?: number } = {},
): Array<{ t: number; reason: Frame["reason"] }> {
  const maxGap = opts.maxGap ?? 6;
  const minGap = opts.minGap ?? 1.5;
  const maxFrames = opts.maxFrames ?? 150;
  const items: Array<{ t: number; reason: Frame["reason"] }> = sceneCuts
    .filter((t) => t >= 0 && t < duration)
    .map((t) => ({ t: t + 0.4, reason: "scene" as const })); // +0,4 s: pega a tela já estabilizada após o corte
  items.push({ t: 0.5, reason: "periodic" });
  items.sort((a, b) => a.t - b.t);
  // preenche buracos
  const filled: typeof items = [];
  let last = -Infinity;
  for (const it of items) {
    // preenche o buraco até o item, mas sem encostar nele (o corte de cena tem prioridade)
    while (last > -Infinity && it.t - last > maxGap && it.t - (last + maxGap) >= minGap) {
      last += maxGap;
      filled.push({ t: last, reason: "periodic" });
    }
    if (it.t - last >= minGap) {
      filled.push(it);
      last = it.t;
    }
  }
  while (duration - last > maxGap) {
    last += maxGap;
    filled.push({ t: last, reason: "periodic" });
  }
  if (filled.length <= maxFrames) return filled;
  // afina: mantém cortes de cena preferencialmente, depois amostra uniforme
  const scenes = filled.filter((f) => f.reason === "scene");
  if (scenes.length >= maxFrames) {
    const step = scenes.length / maxFrames;
    return Array.from({ length: maxFrames }, (_, i) => scenes[Math.floor(i * step)]!);
  }
  const periodic = filled.filter((f) => f.reason === "periodic");
  const room = maxFrames - scenes.length;
  const step = periodic.length / room;
  const picked = Array.from({ length: room }, (_, i) => periodic[Math.floor(i * step)]!);
  return [...scenes, ...picked].sort((a, b) => a.t - b.t);
}

async function extractOne(videoPath: string, t: number, out: string, width: number, signal?: AbortSignal): Promise<void> {
  const r = await run(
    "ffmpeg",
    ["-y", "-v", "error", "-ss", t.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out],
    { signal, timeoutMs: 60_000 },
  );
  if (r.code !== 0) throw new Error(`ffmpeg (frame t=${t}) falhou: ${r.err.trim().slice(-200)}`);
}

/** dHash 64 bits (9×8 cinza, compara vizinhos horizontais). */
export async function dHash(imagePath: string, signal?: AbortSignal): Promise<bigint> {
  const r = await run("ffmpeg", ["-v", "error", "-i", imagePath, "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-"], {
    signal,
    timeoutMs: 30_000,
  });
  const buf = Buffer.from(r.out, "binary");
  return dHashFromGray(buf);
}

export function dHashFromGray(buf: Uint8Array): bigint {
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = buf[y * 9 + x] ?? 0;
      const b = buf[y * 9 + x + 1] ?? 0;
      h = (h << 1n) | (a > b ? 1n : 0n);
    }
  }
  return h;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Extrai os frames planejados e remove quase-iguais consecutivos (distância dHash ≤ 6). */
export async function extractFrames(videoPath: string, duration: number, outDir: string, opts: SceneOptions = {}): Promise<Frame[]> {
  await mkdir(outDir, { recursive: true });
  const cuts = await detectScenes(videoPath, opts.threshold ?? 0.25, opts.signal);
  const plan = planTimestamps(cuts, duration, opts);
  const width = opts.width ?? 1280;
  const conc = opts.concurrency ?? 4;
  const frames: Frame[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < plan.length) {
      const i = next++;
      const p = plan[i]!;
      const path = join(outDir, `f${String(i).padStart(4, "0")}_${p.t.toFixed(1)}s.jpg`);
      await extractOne(videoPath, p.t, path, width, opts.signal);
      frames[i] = { i, t: p.t, path, reason: p.reason };
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, plan.length) }, worker));

  // de-dup por dHash (sequencial: compara com o último mantido)
  const kept: Frame[] = [];
  let lastHash: bigint | null = null;
  for (const f of frames) {
    if (!f) continue;
    const h = await dHash(f.path, opts.signal);
    if (lastHash !== null && hamming(h, lastHash) <= 6) continue;
    lastHash = h;
    kept.push(f);
  }
  return kept.map((f, i) => ({ ...f, i }));
}

/** Frames já extraídos em disco (resume). */
export async function existingFrames(outDir: string): Promise<Frame[]> {
  const names = (await readdir(outDir).catch(() => [] as string[])).filter((n) => n.endsWith(".jpg")).sort();
  return names.map((n, i) => {
    const m = /_(\d+(?:\.\d+)?)s\.jpg$/.exec(n);
    return { i, t: m ? Number(m[1]) : 0, path: join(outDir, n), reason: "scene" as const };
  });
}
