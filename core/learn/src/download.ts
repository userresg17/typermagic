// core/learn/download.ts
// Baixa o vídeo-fonte e as legendas com yt-dlp. Uma língua de legenda por pedido
// (pedir várias de uma vez tomou HTTP 429 do YouTube). Vídeo limitado a 720p: a
// descrição por visão trabalha a 1280px e mais resolução só custa disco e tempo.
// Tudo é escrito em <workDir>/<videoId>/ e reaproveitado se já existir (resume).

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { Downloaded, VideoMeta } from "./types.js";

/** Extrai o id do vídeo de URLs do YouTube (watch, youtu.be, shorts, embed). */
export function videoIdOf(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input;
  const m =
    input.match(/[?&]v=([\w-]{11})/) ??
    input.match(/youtu\.be\/([\w-]{11})/) ??
    input.match(/\/(?:shorts|embed|v|live)\/([\w-]{11})/);
  return m ? m[1]! : null;
}

export function run(cmd: string, args: string[], opts: { signal?: AbortSignal | undefined; timeoutMs?: number | undefined } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let out = "";
    let err = "";
    const timer = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : null;
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/** Lê do info.json só o que o plano usa. */
export function metaFromInfo(info: Record<string, unknown>, url: string): VideoMeta {
  const str = (k: string): string | undefined => (typeof info[k] === "string" ? (info[k] as string) : undefined);
  return {
    id: String(info.id ?? videoIdOf(url) ?? "video"),
    url,
    title: str("title") ?? "(sem título)",
    channel: str("channel") ?? str("uploader"),
    duration: typeof info.duration === "number" ? info.duration : 0,
    uploadDate: str("upload_date"),
    license: str("license"),
  };
}

async function exists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

/** Procura a legenda já baixada, preferindo manual (.<lang>.vtt) a automática. */
async function findSubtitle(dir: string, id: string, langs: string[]): Promise<{ path: string; lang: string } | undefined> {
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const lang of langs) {
    const exact = `${id}.${lang}.vtt`;
    if (files.includes(exact)) return { path: join(dir, exact), lang };
    const loose = files.find((f) => f.startsWith(`${id}.${lang}`) && f.endsWith(".vtt"));
    if (loose) return { path: join(dir, loose), lang };
  }
  return undefined;
}

export interface DownloadOptions {
  workDir: string;
  /** ordem de preferência de língua da legenda */
  langs?: string[];
  signal?: AbortSignal | undefined;
  resume?: boolean | undefined;
  /** binário (padrão "yt-dlp" no PATH) */
  ytDlp?: string;
}

export async function download(url: string, opts: DownloadOptions): Promise<Downloaded> {
  const id = videoIdOf(url);
  if (!id) throw new Error(`URL de vídeo não reconhecida: ${url}`);
  const dir = join(opts.workDir, id);
  await mkdir(dir, { recursive: true });
  const videoPath = join(dir, `${id}.mp4`);
  const infoPath = join(dir, `${id}.info.json`);
  const langs = opts.langs ?? ["pt", "pt-BR", "en"];
  const bin = opts.ytDlp ?? "yt-dlp";

  const have = (opts.resume ?? true) && (await exists(videoPath)) && (await exists(infoPath));
  if (!have) {
    // 1) vídeo + metadados (sem legenda, p/ não misturar erros de legenda com o download)
    const r = await run(
      bin,
      [
        "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b",
        "--merge-output-format", "mp4",
        "--write-info-json", "--no-overwrites", "--no-playlist",
        "-o", join(dir, "%(id)s.%(ext)s"),
        `https://www.youtube.com/watch?v=${id}`,
      ],
      { signal: opts.signal, timeoutMs: 15 * 60_000 },
    );
    if (r.code !== 0 || !(await exists(videoPath))) {
      throw new Error(`yt-dlp falhou (código ${r.code}): ${r.err.trim().split("\n").slice(-3).join(" | ")}`);
    }
  }

  // 2) legenda: uma língua por vez (manual, depois automática), para na primeira que vier
  let sub = await findSubtitle(dir, id, langs);
  if (!sub) {
    for (const lang of langs) {
      for (const flag of ["--write-subs", "--write-auto-subs"]) {
        await run(
          bin,
          [flag, "--sub-langs", lang, "--sub-format", "vtt", "--skip-download", "--no-overwrites",
            "-o", join(dir, "%(id)s.%(ext)s"), `https://www.youtube.com/watch?v=${id}`],
          { signal: opts.signal, timeoutMs: 120_000 },
        );
        sub = await findSubtitle(dir, id, [lang]);
        if (sub) break;
        await new Promise((r) => setTimeout(r, 1500)); // respiro anti-429
      }
      if (sub) break;
    }
  }

  const info = JSON.parse(await readFile(infoPath, "utf8")) as Record<string, unknown>;
  const meta = metaFromInfo(info, url);
  if (sub) meta.subtitleLang = sub.lang;
  return { meta, dir, videoPath, infoPath, ...(sub ? { subtitlePath: sub.path } : {}) };
}
