// core/voice/index.ts
// Voz LOCAL do TyperMagic (v2). ASR agora; TTS entra na Fase 3. Áudio nunca sai da máquina.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { toWav16k } from "./audio.js";
import { transcribeWav, type AsrModel } from "./asr.js";

export { toWav16k } from "./audio.js";
export { transcribeWav, type AsrModel } from "./asr.js";

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
