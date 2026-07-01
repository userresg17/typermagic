import { describe, it, expect } from "vitest";
import { toWav16k } from "../src/audio.js";
import { asrReady } from "../src/index.js";

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

describe("voice — prontidão do ASR", () => {
  it("asrReady=false quando faltam os arquivos do modelo", () => {
    expect(asrReady({ encoder: "/nao/existe", decoder: "/nao/existe", tokens: "/nao/existe" })).toBe(false);
  });
});
