// core/voice/index.ts
// Voz LOCAL do TyperMagic (v2). ASR agora; TTS entra na Fase 3. Áudio nunca sai da máquina.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";
import { toWav16k, toOggOpus } from "./audio.js";
import { transcribeWav, type AsrModel } from "./asr.js";
import { synthesizeWav, type TtsModel } from "./tts.js";
import { synthesizeXttsWav, xttsReady, type XttsConfig } from "./xtts.js";

export { toWav16k, toOggOpus } from "./audio.js";
export { transcribeWav, type AsrModel } from "./asr.js";
export { synthesizeWav, type TtsModel } from "./tts.js";
export { xttsReady, type XttsConfig } from "./xtts.js";

/** caminho do worker Python do XTTS (resolvido a partir do pacote, não do cwd). dist/index.js
 *  → ../py/xtts_worker.py = core/voice/py/xtts_worker.py. */
export const xttsWorkerPath: string = fileURLToPath(new URL("../py/xtts_worker.py", import.meta.url));

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
/** XTTS é ~6x mais lento que tempo real na CPU — encurta MUITO a fala (resumo ~40s); o texto
 *  completo o usuário lê na hora. */
const XTTS_SPOKEN_MAX = 240;

/** corta o texto no limite `cap`, preferindo terminar numa frase (evita cortar no meio). */
function capSpoken(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const head = s.slice(0, cap);
  const cut = head.lastIndexOf(". ");
  return (cut > cap * 0.5 ? head.slice(0, cut + 1) : head).trim();
}

/** Termos em inglês comuns em compras/tech → grafia fonética pt-BR (o espeak com voz pt lê
 *  melhor assim). Best-effort e EXTENSÍVEL — pronúncia perfeita de inglês só com modelo
 *  multilíngue. Aplicado como palavra inteira, sem caixa. */
const EN_RESPELL: Array<[RegExp, string]> = [
  [/\bapple\b/gi, "épou"],
  [/\biphone\b/gi, "aifone"],
  [/\bipad\b/gi, "aipéde"],
  [/\bairpods\b/gi, "érpódis"],
  [/\bmacbook\b/gi, "méquibuque"],
  [/\bnotebook\b/gi, "nôutibuque"],
  [/\bkindle\b/gi, "quíndou"],
  [/\bbluetooth\b/gi, "blutúfi"],
  [/\bwi-?fi\b/gi, "uaifái"],
  [/\bheadset\b/gi, "rédiset"],
  [/\bpay\b/gi, "pei"],
  [/\bprime\b/gi, "praime"],
  [/\bpremium\b/gi, "prêmium"],
  [/\bfree\b/gi, "fri"],
  [/\bblack friday\b/gi, "bléque fráidei"],
  [/\bcashback\b/gi, "quéshibéque"],
  [/\bdelivery\b/gi, "delíveri"],
  [/\bwireless\b/gi, "uáiarlés"],
  [/\bgamer\b/gi, "guêimer"],
  [/\bstreaming\b/gi, "istríming"],
  [/\bsmart\b/gi, "ismárt"],
];

/** Unidades técnicas → por extenso (o TTS lê "256 g b" senão). Só expande após um número. */
const UNITS: Record<string, string> = {
  gb: "gigabytes",
  tb: "terabytes",
  mb: "megabytes",
  kb: "kilobytes",
  ghz: "gigahertz",
  mhz: "megahertz",
  mp: "megapixels",
  mah: "miliampères-hora",
  kwh: "quilowatts-hora",
  km: "quilômetros",
  kg: "quilos",
  cm: "centímetros",
  mm: "milímetros",
  ml: "mililitros",
};

/** Prepara o texto p/ FALA humana: tira markdown/emoji/URL e converte moeda, parcelas e
 *  símbolos em palavras (pt-BR). Sem isso, o TTS lê "asterisco", "U S cifrão", "12 xis" etc.
 *  `respellEnglish` (default true) reescreve termos em inglês na fonética pt — LIGADO no Piper
 *  (só pt), DESLIGADO no Kokoro (que já pronuncia inglês nativo; respell atrapalharia). */
export function speechify(text: string, respellEnglish = true): string {
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
  // parcelamento: "12x" / "12 x" -> "12 vezes" (SÓ com dígito antes; "celular X" continua "X")
  s = s.replace(/(\d+)\s*x\b/gi, "$1 vezes");
  // valor da parcela sem símbolo: "12 vezes de 99,99" -> "... 99 reais e 99 centavos"
  s = s.replace(
    /(vezes(?: de)?\s+)([\d.]+),(\d{2})\b/gi,
    (_m, pre: string, int: string, dec: string) => `${pre}${int.replace(/\./g, "")} reais e ${dec} centavos`,
  );
  // unidades técnicas: "256 GB" -> "256 gigabytes", "8 MP" -> "8 megapixels" (só após número)
  s = s.replace(
    /(\d+)\s*(GB|TB|MB|KB|GHz|MHz|MP|mAh|kWh|km|kg|cm|mm|ml)\b/gi,
    (_m, num: string, u: string) => `${num} ${UNITS[u.toLowerCase()]}`,
  );
  if (respellEnglish) for (const [re, sub] of EN_RESPELL) s = s.replace(re, sub); // inglês -> fonética pt
  s = s.replace(/%/g, " por cento").replace(/&/g, " e "); // símbolos comuns em palavras
  s = s.replace(/\u{FE0F}/gu, ""); // seletor de variação (acompanha emoji): fora primeiro
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2600}-\u{27BF}]/gu, " "); // emoji/setas/dingbats
  s = s.replace(/\s*\n+\s*/g, ". "); // quebras de linha viram pausa (melhora a prosódia)
  s = s.replace(/\s{2,}/g, " ").replace(/(?:\.\s*){2,}/g, ". ").trim(); // colapsa espaço/pontuação repetida
  return s;
}

/** monta a config do worker XTTS a partir do TtsModel. */
function xttsConfigOf(model: TtsModel): XttsConfig {
  return {
    python: model.python ?? "",
    worker: model.worker ?? "",
    language: model.language ?? "pt",
    ...(model.speaker ? { speaker: model.speaker } : {}),
    ...(model.speakerWav ? { speakerWav: model.speakerWav } : {}),
    ...(model.model ? { model: model.model } : {}),
  };
}

/** Sintetiza `text` e grava um OGG/Opus em `outOggPath` — pronto pro Telegram `sendVoice`.
 *  Limpa o texto p/ fala (speechify), gera um WAV temporário e converte p/ OGG. */
export async function synthesize(text: string, outOggPath: string, model: TtsModel): Promise<void> {
  // Kokoro/XTTS pronunciam inglês nativo → NÃO respella; Piper (só pt) → respella.
  const respell = model.engine !== "kokoro" && model.engine !== "xtts";
  const cap = model.engine === "xtts" ? XTTS_SPOKEN_MAX : SPOKEN_MAX;
  const spoken = capSpoken(speechify(text, respell).trim(), cap);
  if (!spoken) throw new Error("TTS: nada a falar depois de limpar o texto");
  const wav = join(tmpdir(), `typer-tts-${process.pid}-${seq++}.wav`);
  if (model.engine === "xtts") await synthesizeXttsWav(spoken, wav, xttsConfigOf(model));
  else await synthesizeWav(spoken, wav, model);
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

/** TTS pronto? sherpa: os arquivos do modelo existem. xtts: o python do venv + o worker existem. */
export function ttsReady(model: TtsModel): boolean {
  if (model.engine === "xtts") return xttsReady(xttsConfigOf(model));
  return existsSync(model.model) && existsSync(model.tokens);
}
