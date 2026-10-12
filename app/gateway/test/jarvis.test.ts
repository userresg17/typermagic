import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { JarvisChannel, answerFromSpeech, VOICE_HINT } from "../src/jarvis.js";
import type { IncomingMessage } from "../src/types.js";

const CONFIRM = [{ text: "✅ Confirmar", data: "ok" }, { text: "🚫 Cancelar", data: "cancel" }];

/** spawn falso: o 1º processo é o ouvido (stdout controlável); os demais são o afplay (sai na hora). */
function fakeSpawn(log: string[]) {
  const ear = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true });
  let first = true;
  const fn = ((cmd: string, args: string[]) => {
    if (first) {
      first = false;
      return ear;
    }
    log.push(`${cmd} ${args.join(" ")}`);
    const p = Object.assign(new EventEmitter(), { kill: () => true });
    setTimeout(() => p.emit("exit", 0), 1);
    return p;
  }) as never;
  const say = (obj: unknown): void => void ear.stdout.write(JSON.stringify(obj) + "\n");
  const earIn: string[] = [];
  ear.stdin.on("data", (d: Buffer) => earIn.push(...d.toString().trim().split("\n")));
  return { fn, say, earIn };
}

function canal(over: Partial<ConstructorParameters<typeof JarvisChannel>[0]> = {}) {
  const played: string[] = [];
  const synth: string[] = [];
  const mirrored: string[] = [];
  const sp = fakeSpawn(played);
  const ch = new JarvisChannel({
    python: "py",
    earScript: "ear.py",
    synthToWav: async (t, wav) => {
      if (wav.includes("jarvis-warm-")) return; // aquecimento da voz no start(): não é fala
      synth.push(`${t}→${wav.endsWith(".wav")}`);
    },
    prepare: (t) => t.replace(/\*\*/g, ""),
    split: (t) => t.split(/(?<=\.)\s+/),
    spawnFn: sp.fn,
    mirror: { text: async (t) => void mirrored.push(t), photo: async (_p, c) => void mirrored.push(`foto:${c}`) },
    ...over,
  });
  const got: IncomingMessage[] = [];
  ch.onMessage((m) => void got.push(m));
  void ch.start();
  return { ch, sp, got, played, synth, mirrored };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("Jarvis: resposta falada vira botão", () => {
  it("sim/pode/confirma → ok; não/cancela → cancel; outra coisa → null", () => {
    expect(answerFromSpeech("Sim.", CONFIRM)).toBe("ok");
    expect(answerFromSpeech("pode confirmar", CONFIRM)).toBe("ok");
    expect(answerFromSpeech("Não, deixa", CONFIRM)).toBe("cancel");
    expect(answerFromSpeech("cancela", CONFIRM)).toBe("cancel");
    expect(answerFromSpeech("qual o preço?", CONFIRM)).toBeNull();
    expect(answerFromSpeech("sim", [])).toBeNull();
  });
});

describe("Jarvis: canal", () => {
  it("comando do ouvido vira pedido ao agente com a instrução de fala curta", async () => {
    const { ch, sp, got, played } = canal();
    sp.say({ event: "command", text: "abre o navegador" });
    await tick();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ senderId: "jarvis", chatId: "jarvis", viaVoice: true });
    expect(got[0]!.text.startsWith(VOICE_HINT)).toBe(true);
    expect(got[0]!.text.endsWith("abre o navegador")).toBe(true);
    expect(played.some((p) => p.includes("Pop.aiff"))).toBe(true);
    ch.stop();
  });

  it("'para' vira /parar (kill switch por voz)", async () => {
    const { ch, sp, got } = canal();
    sp.say({ event: "command", text: "Para." });
    await tick();
    expect(got[0]!.text).toBe("/parar");
    ch.stop();
  });

  it("confirmação: pergunta falada com 'diga sim ou não', resposta 'sim' volta como botão ok", async () => {
    const { ch, sp, got, synth, mirrored } = canal();
    await ch.send("jarvis", "Vou comprar a passagem por R$ 500.", { buttons: [CONFIRM] });
    expect(synth.join(" ")).toMatch(/Diga sim ou não/);
    expect(mirrored[0]).toMatch(/confirmação por voz/);
    sp.say({ event: "command", text: "Sim, pode." });
    await tick();
    expect(got[0]).toMatchObject({ text: "ok", isCallback: true });
    ch.stop();
  });

  it("fala frase a frase e avisa o ouvido (speaking on/off + janela de conversa)", async () => {
    const { ch, sp, synth, played } = canal();
    await ch.send("jarvis", "Primeira frase. Segunda frase. Terceira.");
    expect(synth).toHaveLength(3);
    expect(played.filter((p) => p.includes(".wav"))).toHaveLength(3);
    await tick();
    const cmds = sp.earIn.map((l) => JSON.parse(l));
    expect(cmds[0]).toEqual({ cmd: "speaking", on: true });
    expect(cmds).toContainEqual({ cmd: "speaking", on: false });
    expect(cmds).toContainEqual({ cmd: "listen", seconds: 8 });
    ch.stop();
  });

  it("texto longo ou tabela: fala o começo e manda tudo no Telegram", async () => {
    const { ch, synth, mirrored } = canal({ spokenMax: 60 });
    const longo = "Achei três voos. O mais barato sai às 7h por 480 reais. O segundo sai às 9h por 520. O terceiro às 11h por 610.";
    await ch.send("jarvis", longo);
    expect(mirrored).toEqual([longo]);
    expect(synth.join(" ")).toMatch(/O resto eu mandei no Telegram/);
    expect(synth.join(" ")).not.toMatch(/610/);
    ch.stop();
  });

  it("foto de checkpoint só vai pro Telegram; foto com botões também é falada e espera resposta", async () => {
    const { ch, synth, mirrored } = canal();
    await ch.sendPhoto("jarvis", "AAAA", "📸 passo 5");
    expect(mirrored).toEqual(["foto:📸 passo 5"]);
    expect(synth).toHaveLength(0);
    await ch.sendPhoto("jarvis", "AAAA", "Preciso que você faça login.", { buttons: [CONFIRM] });
    expect(synth.join(" ")).toMatch(/faça login/);
    ch.stop();
  });

  it("'oi Jarvis' por cima interrompe a fala em andamento", async () => {
    let gen = 0;
    const { ch, sp, synth } = canal({
      synthToWav: async (t) => {
        gen++;
        synth.push(t);
        await tick(15);
      },
    });
    const fala = ch.send("jarvis", "Um. Dois. Três. Quatro. Cinco.");
    await tick(5);
    sp.say({ event: "interrupt" });
    await fala;
    expect(gen).toBeLessThan(5);
    ch.stop();
  });
});

import { falaHora } from "../src/jarvis.js";
describe("Jarvis: hora falada como gente", () => {
  it("hora no feminino e por extenso: 'vinte e duas e quarenta e sete'", () => {
    expect(falaHora("Agora são 22:47.")).toBe("Agora são vinte e duas e quarenta e sete.");
    expect(falaHora("São 22h47")).toBe("São vinte e duas e quarenta e sete");
    expect(falaHora("Agora são 22 horas e 47 minutos.")).toBe("Agora são vinte e duas e quarenta e sete.");
    expect(falaHora("São 22 e 47.")).toBe("São vinte e duas e quarenta e sete.");
    expect(falaHora("Começa às 15:00")).toBe("Começa às quinze em ponto");
    expect(falaHora("É 1 e 10")).toBe("É uma e dez");
    expect(falaHora("Almoço 12:30, volta 00:15")).toBe("Almoço meio-dia e trinta, volta meia-noite e quinze");
    expect(falaHora("Sai às 21 em ponto")).toBe("Sai às vinte e uma em ponto");
    expect(falaHora("Agora são 23:00 em ponto.")).toBe("Agora são vinte e três em ponto.");
    expect(falaHora("São 23:00 horas")).toBe("São vinte e três em ponto");
  });
  it("número antes de palavra feminina concorda; dinheiro e masculino ficam como estão", () => {
    expect(falaHora("Achei 2 passagens e 1 opção para 2 pessoas")).toBe("Achei duas passagens e uma opção para duas pessoas");
    expect(falaHora("Tem 200 unidades e 2 dias")).toBe("Tem duzentas unidades e 2 dias");
    expect(falaHora("Custa 22 e 50 reais")).toBe("Custa 22 e 50 reais");
  });
});

describe("Jarvis: caixinha na tela", () => {
  it("comando → 'thinking' com o que foi dito; fala → 'speaking'; fim → 'done'", async () => {
    const huds: string[] = [];
    const { ch, sp } = canal({ hud: { python: "py", script: "hud.py" } });
    const orig = ch.hud.bind(ch);
    ch.hud = (state: string, text = "") => {
      huds.push(state);
      orig(state, text);
    };
    sp.say({ event: "wake" });
    sp.say({ event: "command", text: "que horas são" });
    await tick();
    await ch.send("jarvis", "Agora são 22:34.");
    await tick();
    expect(huds.slice(0, 2)).toEqual(["listening", "thinking"]);
    expect(huds).toContain("speaking");
    expect(huds[huds.length - 1]).toBe("done");
    ch.stop();
  });
});

describe("Jarvis: ruído na janela de conversa", () => {
  it("'E...' solto depois da resposta não vira pedido; pergunta de verdade vira", async () => {
    const { ch, sp, got } = canal();
    sp.say({ event: "command", text: "E...", followup: true });
    await tick();
    expect(got).toHaveLength(0);
    sp.say({ event: "command", text: "e amanhã?", followup: true });
    await tick();
    expect(got).toHaveLength(1);
    ch.stop();
  });
});
