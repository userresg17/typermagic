import { describe, it, expect } from "vitest";
import { toWav16k, toOggOpus } from "../src/audio.js";
import { asrReady, ttsReady, speechify } from "../src/index.js";

describe("voice — conversão de áudio (ffmpeg)", () => {
  it("monta o comando ffmpeg certo (WAV 16kHz mono) e resolve no sucesso", async () => {
    let got: string[] = [];
    await toWav16k("in.oga", "out.wav", async (args) => {
      got = args;
      return { code: 0, err: "" };
    });
    expect(got).toEqual(["-y", "-i", "in.oga", "-ar", "16000", "-ac", "1", "-f", "wav", "out.wav"]);
  });

  it("lança erro claro quando o ffmpeg falha", async () => {
    await expect(toWav16k("in.oga", "out.wav", async () => ({ code: 1, err: "boom" }))).rejects.toThrow(
      /ffmpeg falhou/,
    );
  });
});

describe("voice — conversão p/ voz do Telegram (OGG/Opus)", () => {
  it("monta o comando ffmpeg certo (libopus, 48kHz mono, voip) e resolve no sucesso", async () => {
    let got: string[] = [];
    await toOggOpus("in.wav", "out.ogg", async (args) => {
      got = args;
      return { code: 0, err: "" };
    });
    expect(got).toEqual([
      "-y", "-i", "in.wav", "-c:a", "libopus", "-b:a", "32k",
      "-ar", "48000", "-ac", "1", "-application", "voip", "-f", "ogg", "out.ogg",
    ]);
  });

  it("lança erro claro quando o ffmpeg falha ao gerar OGG", async () => {
    await expect(toOggOpus("in.wav", "out.ogg", async () => ({ code: 1, err: "boom" }))).rejects.toThrow(
      /OGG\/Opus falhou|ffmpeg falhou/,
    );
  });
});

describe("voice — speechify (limpa o texto p/ fala)", () => {
  it("tira ênfase markdown e não deixa asterisco", () => {
    expect(speechify("preço **US$ 49,99** hoje")).toBe("preço 49 dólares e 99 centavos hoje");
  });

  it("converte R$ com centavos e sem centavos", () => {
    expect(speechify("são R$ 1.500,50")).toBe("são 1500 reais e 50 centavos");
    expect(speechify("total R$ 20")).toBe("total 20 reais");
  });

  it("remove emoji, URL e vira link em rótulo", () => {
    const out = speechify("🎙️ veja [o repo](https://github.com/x/y) agora");
    expect(out).toBe("veja o repo agora");
  });

  it("tira marcadores de lista e cabeçalho, juntando em pausa", () => {
    expect(speechify("# Título\n- um\n- dois")).toBe("Título. um. dois");
  });

  it("% e & viram palavras", () => {
    expect(speechify("subiu 10% e caiu")).toBe("subiu 10 por cento e caiu");
  });
});

describe("voice — prontidão do ASR/TTS", () => {
  it("asrReady=false quando faltam os arquivos do modelo", () => {
    expect(asrReady({ encoder: "/nao/existe", decoder: "/nao/existe", tokens: "/nao/existe" })).toBe(false);
  });

  it("ttsReady=false quando faltam os arquivos do modelo de voz", () => {
    expect(ttsReady({ model: "/nao/existe", tokens: "/nao/existe" })).toBe(false);
  });
});
