// core/voice/asr.ts
// ASR (voz→texto) LOCAL via sherpa-onnx rodando um modelo Whisper. Carrega o modelo UMA vez
// (reusa entre chamadas) e usa a API assíncrona (não bloqueia o event loop do gateway 24/7).
// O modelo é baixado à parte (opt-in) — os caminhos vêm no AsrModel.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AsrModel {
  /** whisper encoder .onnx */
  encoder: string;
  /** whisper decoder .onnx */
  decoder: string;
  /** tokens.txt */
  tokens: string;
  /** idioma ISO ("pt") ou "" p/ autodetecção. */
  language?: string;
  numThreads?: number;
}

let recognizerP: Promise<any> | null = null;

/** carrega o módulo nativo do sherpa-onnx-node (CJS) de forma tolerante ao interop. */
async function loadSherpa(): Promise<any> {
  const mod: any = await import("sherpa-onnx-node");
  return mod.default ?? mod;
}

async function loadRecognizer(m: AsrModel): Promise<any> {
  const S = await loadSherpa();
  return S.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: m.encoder, decoder: m.decoder, language: m.language ?? "", task: "transcribe" },
      tokens: m.tokens,
      numThreads: m.numThreads ?? 2,
      provider: "cpu",
      debug: 0,
    },
  });
}

/** Transcreve um WAV 16kHz mono → texto. O 1º chamado carrega o modelo; os próximos reusam. */
export async function transcribeWav(wavPath: string, model: AsrModel): Promise<string> {
  const S = await loadSherpa();
  if (!recognizerP) recognizerP = loadRecognizer(model);
  const rec = await recognizerP;
  const wave = S.readWave(wavPath); // { samples: Float32Array, sampleRate }
  const stream = rec.createStream();
  stream.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
  const result = await rec.decodeAsync(stream);
  const text: string = result?.text ?? rec.getResult(stream)?.text ?? "";
  return text.trim();
}
