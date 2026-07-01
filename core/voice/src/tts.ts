// core/voice/tts.ts
// TTS LOCAL (voz-OUT) via sherpa-onnx OfflineTts — CPU, offline. Dois engines:
//  - "piper"  (VITS pt_BR): RÁPIDO (~0.4x tempo real), leve; inglês fica torto (só pt) → dicionário.
//  - "kokoro" (multilíngue): fala inglês NATIVO e soa mais natural, mas é ~5x tempo real na CPU
//    (12x mais lento que o Piper) — resposta de voz demora ~25s. Opt-in p/ quem prefere qualidade.
// Escolha de engenharia: NÃO usamos OmniVoice (PyTorch/GPU, subprocess Python) — ambos rodam no
// mesmo addon nativo do ASR, 100% local. Mesma interface `synthesize()`.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TtsModel {
  /** engine: "piper" (rápido, sherpa), "kokoro" (multilíngue sherpa, sem pt) ou
   *  "xtts" (Coqui/PyTorch: pt-BR natural + inglês nativo, lento na CPU). */
  engine?: "piper" | "kokoro" | "xtts";
  /** sherpa: .onnx do modelo. xtts: nome do modelo HF (ou "" — baixa sozinho). */
  model: string;
  /** tokens.txt do modelo (sherpa). Vazio p/ xtts. */
  tokens: string;
  /** xtts: python do venv */
  python?: string;
  /** xtts: caminho do xtts_worker.py */
  worker?: string;
  /** xtts: locutor embutido (default = 1º do modelo) */
  speaker?: string;
  /** xtts: wav de referência p/ clonar a voz */
  speakerWav?: string;
  /** xtts: idioma alvo (default "pt") */
  language?: string;
  /** dir de dados fonéticos (espeak-ng-data) */
  dataDir?: string;
  /** lexicon(s) — Piper: um arquivo; Kokoro: lista separada por vírgula (en,zh) */
  lexicon?: string;
  /** Kokoro: voices.bin (embeddings dos locutores) */
  voices?: string;
  /** Kokoro: dir dict/ (regras de zh/números) */
  dictDir?: string;
  numThreads?: number;
  /** speaker id (multi-locutor). Piper pt: 0. Kokoro pt-BR: 44 (pm_alex). */
  sid?: number;
  /** velocidade da fala; default 1.0 (Piper usa <1 p/ desacelerar) */
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
  const key = `${model.engine ?? "piper"}|${model.model}|${model.tokens}|${model.dataDir ?? ""}`;
  if (!ttsP || ttsKey !== key) {
    ttsKey = key;
    const S = await loadSherpa();
    // Kokoro e VITS têm chaves de config diferentes no OfflineTts.
    const modelConfig =
      model.engine === "kokoro"
        ? {
            kokoro: {
              model: model.model,
              tokens: model.tokens,
              ...(model.voices ? { voices: model.voices } : {}),
              ...(model.dataDir ? { dataDir: model.dataDir } : {}),
              ...(model.dictDir ? { dictDir: model.dictDir } : {}),
              ...(model.lexicon ? { lexicon: model.lexicon } : {}),
            },
          }
        : {
            vits: {
              model: model.model,
              tokens: model.tokens,
              ...(model.dataDir ? { dataDir: model.dataDir } : {}),
              ...(model.lexicon ? { lexicon: model.lexicon } : {}),
            },
          };
    ttsP = S.OfflineTts.createAsync({
      model: modelConfig,
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
