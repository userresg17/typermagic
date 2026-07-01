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

/** limite de caracteres FALADOS — resposta longa vira áudio arrastado; o texto tem tudo. */
const SPOKEN_MAX = 700;

/** Prepara o texto p/ FALA humana: tira markdown/emoji/URL e converte moeda e símbolos em
 *  palavras (pt-BR). Sem isso, o TTS lê "asterisco", "U S cifrão", "hashtag" etc. */
export function speechify(text: string): string {
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, " "); // blocos de código cercados: fora (ninguém ouve código)
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // [rótulo](url) / ![alt](url) -> rótulo/alt
  s = s.replace(/https?:\/\/\S+/g, " "); // URLs cruas: fora
  s = s.replace(/`([^`]*)`/g, "$1"); // código inline `x` -> x
  s = s.replace(/(\*\*|\*|__|_)(.*?)\1/g, "$2"); // ênfase **x** *x* __x__ _x_ -> x
  s = s.replace(/^[ \t]*([#>]+|[-*+•]|\d+\.)[ \t]+/gm, ""); // marcador/cabeçalho/citação no início
  s = s.replace(/^[ \t]*\|?[ \t]*:?-{2,}.*$/gm, " "); // linha separadora de tabela ---|--- : fora
  s = s.replace(/\|/g, ", "); // células de tabela viram pausa
  // moeda pt-BR: "US$ 49,99" -> "49 dólares e 99 centavos" (a unidade vem DEPOIS na fala)
  s = s.replace(/(R\$|US\$|\$|€)\s*([\d.]+)(?:,(\d{1,2}))?/g, (_m, sym: string, int: string, dec?: string) => {
    const unit = sym === "R$" ? "reais" : sym === "€" ? "euros" : "dólares";
    const n = int.replace(/\./g, ""); // tira separador de milhar (o espeak lê os dígitos)
    return dec ? `${n} ${unit} e ${dec} centavos` : `${n} ${unit}`;
  });
  s = s.replace(/%/g, " por cento").replace(/&/g, " e "); // símbolos comuns em palavras
  s = s.replace(/\u{FE0F}/gu, ""); // seletor de variação (acompanha emoji): fora primeiro
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2600}-\u{27BF}]/gu, " "); // emoji/setas/dingbats
  s = s.replace(/\s*\n+\s*/g, ". "); // quebras de linha viram pausa (melhora a prosódia)
  s = s.replace(/\s{2,}/g, " ").replace(/(?:\.\s*){2,}/g, ". ").trim(); // colapsa espaço/pontuação repetida
  return s;
}

/** Sintetiza `text` e grava um OGG/Opus em `outOggPath` — pronto pro Telegram `sendVoice`.
 *  Limpa o texto p/ fala (speechify), gera um WAV temporário e converte p/ OGG. */
export async function synthesize(text: string, outOggPath: string, model: TtsModel): Promise<void> {
  const spoken = speechify(text).slice(0, SPOKEN_MAX).trim();
  if (!spoken) throw new Error("TTS: nada a falar depois de limpar o texto");
  const wav = join(tmpdir(), `typer-tts-${process.pid}-${seq++}.wav`);
  await synthesizeWav(spoken, wav, model);
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
