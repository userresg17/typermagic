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

  it('centavos "00" somem (99,00 -> "99 reais")', () => {
    expect(speechify("custa R$ 99,00")).toBe("custa 99 reais");
    expect(speechify("em 10x de 50,00")).toBe("em 10 vezes de 50 reais");
  });

  it("URL/domínio vira só o nome (sem ler ponto/traço/caminho)", () => {
    expect(speechify("compre em www.amazon.com.br agora")).toBe("compre em amazon agora");
    expect(speechify("veja https://www.mercadolivre.com.br/p/MLB123 hoje")).toBe("veja mercadolivre hoje");
  });

  it("não lê pontuação em voz alta (: / * _ () etc.), vira pausa/espaço", () => {
    expect(speechify("Resultado: achei 3 opções")).toBe("Resultado, achei 3 opções");
    expect(speechify("preto/branco e (novo)")).toBe("preto branco e novo");
    expect(speechify("item _um_ e *dois*")).toBe("item um e dois");
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

  it('parcela "12x de 99,99" vira "12 vezes de 99 reais e 99 centavos"', () => {
    expect(speechify("em 12x de 99,99")).toBe("em 12 vezes de 99 reais e 99 centavos");
    expect(speechify("em 10x sem juros")).toBe("em 10 vezes sem juros");
  });

  it('não mexe no "X" de nome (sem dígito antes)', () => {
    expect(speechify("o celular X é bom")).toBe("o celular X é bom");
  });

  it("termos em inglês viram grafia fonética pt-BR", () => {
    expect(speechify("Amazon Prime é free")).toBe("Amazon praime é fri");
    expect(speechify("iPhone da Apple no Nu Pay")).toBe("aifone da épou no Nu pei");
  });

  it("unidades técnicas por extenso após número", () => {
    expect(speechify("256 GB e 8 MP")).toBe("256 gigabytes e 8 megapixels");
    expect(speechify("bateria 5000mAh")).toBe("bateria 5000 miliampères hora");
  });

  it("com respellEnglish=false (Kokoro), mantém o inglês original mas ainda limpa markdown/moeda", () => {
    expect(speechify("**Apple Prime** por US$ 49,99", false)).toBe("Apple Prime por 49 dólares e 99 centavos");
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
