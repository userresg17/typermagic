// core/voice/tts.ts
// TTS LOCAL (voz-OUT) via sherpa-onnx OfflineTts — modelo VITS/Piper PT rodando em CPU, offline.
// Escolha de engenharia: NÃO usamos o OmniVoice (PyTorch, prefere GPU, subprocess Python pesado)
// pro serviço 24/7 — o VITS/Piper do próprio sherpa-onnx é leve, mesmo addon nativo que o ASR já
// usa, e mantém tudo 100% local. Mesma interface `synthesize()`; dá pra trocar por OmniVoice depois.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TtsModel {
  /** .onnx do VITS/Piper */
  model: string;
  /** tokens.txt do modelo */
  tokens: string;
  /** dir de dados fonéticos (espeak-ng-data) — exigido pelos modelos Piper */
  dataDir?: string;
  /** lexicon.txt (modelos com léxico próprio) */
  lexicon?: string;
  numThreads?: number;
  /** speaker id (modelos multi-locutor); default 0 */
  sid?: number;
  /** velocidade da fala; default 1.0 */
  speed?: number;
}

// carrega o modelo UMA vez por config (o construtor nativo é caro) e reusa.
let ttsP: Promise<any> | null = null;
let ttsKey = "";

/** carrega o módulo nativo do sherpa-onnx-node (CJS) de forma tolerante ao interop. */
async function loadSherpa(): Promise<any> {
  const mod: any = await import("sherpa-onnx-node");
  return mod.default ?? mod;
}

async function getTts(model: TtsModel): Promise<any> {
  const key = `${model.model}|${model.tokens}|${model.dataDir ?? ""}`;
  if (!ttsP || ttsKey !== key) {
    ttsKey = key;
    const S = await loadSherpa();
    ttsP = S.OfflineTts.createAsync({
      model: {
        vits: {
          model: model.model,
          tokens: model.tokens,
          ...(model.dataDir ? { dataDir: model.dataDir } : {}),
          ...(model.lexicon ? { lexicon: model.lexicon } : {}),
        },
      },
      numThreads: model.numThreads ?? 2,
      provider: "cpu",
      debug: 0,
    });
  }
  return ttsP;
}

/** Sintetiza `text` e grava um WAV em `outWavPath`. Assíncrono (não trava o event loop). */
export async function synthesizeWav(text: string, outWavPath: string, model: TtsModel): Promise<void> {
  const clean = text.trim();
  if (!clean) throw new Error("TTS: texto vazio");
  const tts = await getTts(model);
  const audio = await tts.generateAsync({ text: clean, sid: model.sid ?? 0, speed: model.speed ?? 1.0 });
  const S = await loadSherpa();
  S.writeWave(outWavPath, { samples: audio.samples, sampleRate: audio.sampleRate });
}
