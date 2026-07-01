// core/voice/audio.ts
// Converte áudio p/ WAV 16kHz mono PCM — o formato que Whisper/sherpa-onnx esperam. O Telegram
// manda voz em OGG/Opus; o ffmpeg converte. Runner injetável p/ testar sem subprocesso.

import { spawn } from "node:child_process";

export type FfmpegRunner = (args: string[]) => Promise<{ code: number; err: string }>;

const realRunner: FfmpegRunner = (args) =>
  new Promise((resolve) => {
    let err = "";
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    c.stderr?.on("data", (d) => (err += d.toString()));
    c.on("error", (e) => resolve({ code: -1, err: e.message }));
    c.on("close", (code) => resolve({ code: code ?? -1, err }));
  });

/** Converte qualquer áudio (OGG/Opus do Telegram etc.) p/ WAV 16kHz mono. Lança em erro. */
export async function toWav16k(inPath: string, outPath: string, run: FfmpegRunner = realRunner): Promise<void> {
  const { code, err } = await run(["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", outPath]);
  if (code !== 0) throw new Error(`ffmpeg falhou (${code}) ao converter áudio: ${err.slice(-200)}`);
}

/** Converte um WAV (saída do TTS) p/ OGG/Opus — o formato que o Telegram `sendVoice` exige
 *  (voz nativa, com waveform). 48kHz/voip é o que o app espera. Lança em erro. */
export async function toOggOpus(inPath: string, outOgg: string, run: FfmpegRunner = realRunner): Promise<void> {
  const { code, err } = await run(
    ["-y", "-i", inPath, "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", "-application", "voip", "-f", "ogg", outOgg],
  );
  if (code !== 0) throw new Error(`ffmpeg falhou (${code}) ao gerar OGG/Opus: ${err.slice(-200)}`);
}
