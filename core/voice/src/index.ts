// core/voice/index.ts
// Voz LOCAL do TyperMagic (v2). ASR agora; TTS entra na Fase 3. Áudio nunca sai da máquina.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { toWav16k, toOggOpus } from "./audio.js";
import { transcribeWav, type AsrModel } from "./asr.js";
import { synthesizeWav, type TtsModel } from "./tts.js";

export { toWav16k, toOggOpus } from "./audio.js";
export { transcribeWav, type AsrModel } from "./asr.js";
export { synthesizeWav, type TtsModel } from "./tts.js";

let seq = 0;

/** Transcreve um áudio QUALQUER (OGG/Opus do Telegram, etc.): converte p/ WAV 16k e reconhece.
 *  Limpa o WAV temporário no fim. */
export async function transcribe(audioPath: string, model: AsrModel): Promise<string> {
  const wav = join(tmpdir(), `typer-voice-${process.pid}-${seq++}.wav`);
  await toWav16k(audioPath, wav);
  try {
    return await transcribeWav(wav, model);
  } finally {
    try {
      unlinkSync(wav);
    } catch {
      /* já foi */
    }
  }
}

/** ASR pronto? (os 3 arquivos do modelo Whisper existem). */
export function asrReady(model: AsrModel): boolean {
  return existsSync(model.encoder) && existsSync(model.decoder) && existsSync(model.tokens);
}

/** Sintetiza `text` e grava um OGG/Opus em `outOggPath` — pronto pro Telegram `sendVoice`.
 *  Gera um WAV temporário (TTS) e converte p/ OGG; limpa o WAV no fim. */
export async function synthesize(text: string, outOggPath: string, model: TtsModel): Promise<void> {
  const wav = join(tmpdir(), `typer-tts-${process.pid}-${seq++}.wav`);
  await synthesizeWav(text, wav, model);
  try {
    await toOggOpus(wav, outOggPath);
  } finally {
    try {
      unlinkSync(wav);
    } catch {
      /* já foi */
    }
  }
}

/** TTS pronto? (o .onnx e os tokens do modelo de voz existem). */
export function ttsReady(model: TtsModel): boolean {
  return existsSync(model.model) && existsSync(model.tokens);
}
