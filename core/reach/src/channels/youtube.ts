// core/reach/channels/youtube.ts
// Canal YouTube: extrai a TRANSCRIÇÃO de um vídeo. Backends:
//   1) native — pega as captionTracks da página e baixa o timedtext (zero-dep)
//   2) yt-dlp — fallback via CLI (se instalado): yt-dlp -j → URL de legenda → fetch

import type { Backend, Channel, ReachContext, ReachResult } from "../types.js";
import { fetchText, decodeEntities } from "../http.js";

/** Extrai o id do vídeo de várias formas de URL. */
export function parseVideoId(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input;
  const m =
    input.match(/[?&]v=([\w-]{11})/) ??
    input.match(/youtu\.be\/([\w-]{11})/) ??
    input.match(/\/(?:shorts|embed|v)\/([\w-]{11})/);
  return m ? m[1]! : null;
}

/** timedtext XML → texto corrido. */
export function parseTimedText(xml: string): string {
  return [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => decodeEntities(m[1]!.replace(/<[^>]+>/g, "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** json3 (formato default do yt-dlp/innertube) → texto corrido. */
export function parseJson3(json: string): string {
  try {
    const data = JSON.parse(json) as { events?: { segs?: { utf8?: string }[] }[] };
    return (data.events ?? [])
      .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join(""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/** WEBVTT → texto corrido (descarta cabeçalho, índices, timestamps e tags). */
export function parseVtt(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter(
      (l) =>
        l.trim() &&
        !/^(WEBVTT|Kind:|Language:)/.test(l) &&
        !l.includes("-->") &&
        !/^\d+$/.test(l.trim()),
    )
    .map((l) => l.replace(/<[^>]+>/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detecta o formato da legenda (json3, vtt ou xml timedtext) e extrai o texto. */
export function captionsToText(body: string): string {
  const head = body.trimStart();
  if (head.startsWith("{")) return parseJson3(body);
  if (head.startsWith("WEBVTT")) return parseVtt(body);
  return parseTimedText(body);
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

async function fetchTranscript(id: string, ctx: ReachContext): Promise<ReachResult> {
  const watch = await fetchText(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    timeoutMs: ctx.timeoutMs,
    headers: { "user-agent": "Mozilla/5.0", "accept-language": "en-US,en;q=0.9" },
  });
  const m = watch.text.match(/"captionTracks":(\[.*?\])/);
  if (!m) return { ok: false, error: { code: "no_captions", message: "vídeo sem legendas disponíveis" } };
  let tracks: CaptionTrack[];
  try {
    tracks = JSON.parse(m[1]!) as CaptionTrack[];
  } catch {
    return { ok: false, error: { code: "parse_failed", message: "não consegui ler as legendas" } };
  }
  const track =
    tracks.find((t) => t.languageCode?.startsWith("en")) ??
    tracks.find((t) => t.languageCode?.startsWith("pt")) ??
    tracks[0];
  if (!track?.baseUrl) return { ok: false, error: { code: "no_captions", message: "sem faixa de legenda" } };
  const sub = await fetchText(track.baseUrl, { timeoutMs: ctx.timeoutMs });
  const text = captionsToText(sub.text);
  if (!text) return { ok: false, error: { code: "empty", message: "transcrição vazia" } };
  return { ok: true, content: text, meta: { id, lang: track.languageCode } };
}

const nativeBackend: Backend = {
  name: "native",
  available: () => true,
  // hoje o timedtext volta vazio sem PoToken; serve só como 1ª tentativa barata.
  // O doctor não conta isso como "pronto" — quem entrega de verdade é o yt-dlp.
  probeReliable: false,
  run: async (input, ctx) => {
    const id = parseVideoId(input);
    if (!id) return { ok: false, error: { code: "bad_url", message: "URL de YouTube inválida" } };
    return fetchTranscript(id, ctx);
  },
};

const ytdlpBackend: Backend = {
  name: "yt-dlp",
  available: async (ctx) => {
    if (!ctx.runArgv) return false;
    try {
      return (await ctx.runArgv("yt-dlp", ["--version"])).code === 0;
    } catch {
      return false;
    }
  },
  run: async (input, ctx) => {
    if (!ctx.runArgv) return { ok: false, error: { code: "no_exec", message: "sem runArgv" } };
    const r = await ctx.runArgv("yt-dlp", ["-j", "--skip-download", input]);
    if (r.code !== 0) return { ok: false, error: { code: "ytdlp_failed", message: r.stderr.slice(0, 200) } };
    try {
      const info = JSON.parse(r.stdout) as {
        subtitles?: Record<string, { ext?: string; url: string }[]>;
        automatic_captions?: Record<string, { ext?: string; url: string }[]>;
      };
      const langs = { ...info.automatic_captions, ...info.subtitles };
      const fmts = langs["en"] ?? langs["pt"] ?? Object.values(langs)[0];
      // prefere um formato fácil de parsear (srv1/vtt) antes do json3 (default do yt-dlp)
      const fmt = fmts?.find((f) => f.ext === "srv1") ?? fmts?.find((f) => f.ext === "vtt") ?? fmts?.[0];
      const url = fmt?.url;
      if (!url) return { ok: false, error: { code: "no_captions", message: "sem legendas no yt-dlp" } };
      const sub = await fetchText(url, { timeoutMs: ctx.timeoutMs });
      const text = captionsToText(sub.text);
      return text ? { ok: true, content: text } : { ok: false, error: { code: "empty", message: "vazio" } };
    } catch (e) {
      return { ok: false, error: { code: "parse_failed", message: (e as Error).message } };
    }
  },
};

export const youtubeChannel: Channel = {
  name: "youtube",
  description: "Transcrição de vídeos do YouTube",
  tier: "zero-config",
  // yt-dlp primeiro (é o que funciona); nativo como último recurso barato.
  backends: [ytdlpBackend, nativeBackend],
  matches: (input) => /(?:youtube\.com|youtu\.be)/i.test(input),
};
