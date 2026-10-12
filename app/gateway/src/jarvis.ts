// app/gateway/jarvis.ts
// Canal JARVIS: conversa por voz no próprio Mac, sem apertar nada. Um ouvido Python
// (platform/voice/jarvis_ear.py) fica escutando o microfone e só reage a "oi Jarvis"; o texto
// entendido entra no MESMO gateway do typer (mesmo agente, mesmas ferramentas, mesmas
// confirmações). A resposta é falada frase por frase (a 1ª toca enquanto a 2ª é sintetizada).
// Confirmação de ação irreversível = dizer "sim" ou "não". Texto longo e fotos de checkpoint
// vão também para o Telegram do dono (espelho), porque ninguém quer ouvir uma tabela.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import type { Button, ChannelAdapter, IncomingMessage, SendOptions } from "./types.js";

export interface JarvisMirror {
  text?(text: string): Promise<void>;
  photo?(pngBase64: string, caption?: string): Promise<void>;
}

export interface JarvisOptions {
  /** python do venv do ouvido (~/.typer/voice/jarvis-venv/bin/python) */
  python: string;
  /** caminho do platform/voice/jarvis_ear.py */
  earScript: string;
  /** sintetiza texto JÁ preparado num WAV */
  synthToWav: (text: string, wavPath: string) => Promise<void>;
  /** prepara texto p/ fala (tira markdown, URL, emoji…) */
  prepare: (text: string) => string;
  /** fatia em frases */
  split: (text: string) => string[];
  /** id usado como remetente/chat (precisa estar na allowlist do gateway) */
  senderId?: string;
  /** espelho no Telegram (texto longo, fotos) */
  mirror?: JarvisMirror;
  /** limite de caracteres falados; o resto vai pro espelho (default 600) */
  spokenMax?: number;
  /** player de áudio (default afplay) */
  player?: string;
  /** env extra p/ o ouvido (JARVIS_MIC, JARVIS_ASR…) */
  earEnv?: Record<string, string>;
  log?: (m: string) => void;
  /** spawn injetável (teste) */
  spawnFn?: typeof spawn;
}

const SOUND_WAKE = "/System/Library/Sounds/Tink.aiff";
const SOUND_ACK = "/System/Library/Sounds/Pop.aiff";

const YES = /^(sim|s|pode|pode sim|confirm\w*|ok|okay|manda|vai|claro|isso|positivo|fechado|beleza|bora|autorizo|aprovad\w*|faz)\b/i;
const NO = /^(n[aã]o|nao|cancela\w*|para|pare|negativo|nem|esquece|aborta\w*)\b/i;
const STOP = /^(para|pare|parar|chega|cancela tudo|para tudo|stop)\W*$/i;

/** instrução de estilo que vai na frente de todo pedido falado (resposta será OUVIDA). */
export const VOICE_HINT = "[Pedido falado ao Jarvis no Mac. Responda como fala natural, curto: 1 a 3 frases, sem listas, tabelas, markdown, emojis ou links.]";

/** mapeia a resposta falada para o dado de um botão pendente ("sim" → "ok"). null = não é sim/não. */
export function answerFromSpeech(text: string, buttons: Button[]): string | null {
  const t = text.trim().replace(/^[\s,.!?]+/, "");
  if (!buttons.length) return null;
  const pick = (re: RegExp, fallback: Button | undefined): string | null => {
    const b = buttons.find((x) => re.test(x.data) || re.test(x.text)) ?? fallback;
    return b ? b.data : null;
  };
  if (YES.test(t)) return pick(/ok|yes|sim|approve|confirm|aprova/i, buttons[0]);
  if (NO.test(t)) return pick(/cancel|no\b|n[aã]o|deny|recusa/i, buttons[buttons.length - 1]);
  return null;
}

export class JarvisChannel implements ChannelAdapter {
  readonly name = "jarvis";
  private cb: ((m: IncomingMessage) => void | Promise<void>) | undefined;
  private ear: ChildProcess | null = null;
  private stopped = false;
  private buttons: Button[] = [];
  private queue: Promise<void> = Promise.resolve();
  private gen = 0; // incrementa a cada interrupção: frases de gerações antigas não tocam
  private player: ChildProcess | null = null;
  private pendingSpeech = 0;
  private seq = 0;
  private readonly id: string;

  constructor(private readonly o: JarvisOptions) {
    this.id = o.senderId ?? "jarvis";
  }

  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void {
    this.cb = cb;
  }

  private log(m: string): void {
    this.o.log?.(m);
  }

  private earSend(obj: Record<string, unknown>): void {
    try {
      this.ear?.stdin?.write(JSON.stringify(obj) + "\n");
    } catch {
      /* ouvido reiniciando */
    }
  }

  private play(file: string): Promise<void> {
    return new Promise((resolve) => {
      const sp = this.o.spawnFn ?? spawn;
      const p = sp(this.o.player ?? "afplay", [file], { stdio: "ignore" });
      this.player = p;
      p.on("exit", () => {
        if (this.player === p) this.player = null;
        resolve();
      });
      p.on("error", () => resolve());
    });
  }

  private chime(file: string): void {
    void this.play(file);
  }

  /** para de falar AGORA (o usuário disse "oi Jarvis" por cima). */
  interrupt(): void {
    this.gen++;
    this.player?.kill("SIGTERM");
    this.player = null;
  }

  /** fala um texto: sintetiza frase a frase, tocando a anterior enquanto gera a próxima. */
  speak(text: string): Promise<void> {
    const spoken = this.o.prepare(text);
    if (!spoken) return Promise.resolve();
    const frases = this.o.split(spoken);
    const g = this.gen;
    this.pendingSpeech++;
    this.earSend({ cmd: "speaking", on: true });
    const job = async (): Promise<void> => {
      let next: Promise<string | null> | null = null;
      const synth = (s: string): Promise<string | null> => {
        const wav = join(tmpdir(), `jarvis-${process.pid}-${this.seq++}.wav`);
        return this.o.synthToWav(s, wav).then(
          () => wav,
          (e) => {
            this.log(`tts falhou: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          },
        );
      };
      for (let i = 0; i < frases.length; i++) {
        if (g !== this.gen) break;
        const cur = next ?? synth(frases[i]!);
        next = i + 1 < frases.length ? synth(frases[i + 1]!) : null;
        const wav = await cur;
        if (wav && g === this.gen) await this.play(wav);
        if (wav) void unlink(wav).catch(() => {});
      }
      if (next) void next.then((w) => { if (w) void unlink(w).catch(() => {}); });
    };
    this.queue = this.queue.then(job, job).finally(() => {
      this.pendingSpeech--;
      if (this.pendingSpeech === 0) {
        this.earSend({ cmd: "speaking", on: false });
        // janela de conversa: dá para responder sem chamar "oi Jarvis" de novo
        this.earSend({ cmd: "listen", seconds: this.buttons.length ? 20 : 8 });
      }
    });
    return this.queue;
  }

  async send(_chatId: string, text: string, opts?: SendOptions): Promise<void> {
    const t = text.trim();
    if (!t) return;
    const max = this.o.spokenMax ?? 600;
    if (opts?.buttons?.length) {
      this.buttons = opts.buttons.flat();
      await this.o.mirror?.text?.(`🎙️ Jarvis pediu confirmação por voz:\n${t}`).catch(() => {});
      await this.speak(`${t}\nDiga sim ou não.`);
      return;
    }
    if (/^🔎/.test(t)) {
      await this.speak("Tô vendo isso, já te falo.");
      return;
    }
    if (t.length > max || /\|.*\|/.test(t) || (t.match(/\n/g)?.length ?? 0) > 6) {
      await this.o.mirror?.text?.(t).catch(() => {});
      const head = this.o.prepare(t);
      const cut = head.slice(0, max);
      const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
      await this.speak(`${end > max * 0.4 ? cut.slice(0, end + 1) : cut} O resto eu mandei no Telegram.`);
      return;
    }
    await this.speak(t);
  }

  async sendPhoto(chatId: string, pngBase64: string, caption?: string, opts?: SendOptions): Promise<void> {
    await this.o.mirror?.photo?.(pngBase64, caption).catch(() => {});
    // foto com botões = pede ação sua (ex.: passo que só uma pessoa faz): fala e espera a resposta
    if (opts?.buttons?.length && caption) await this.send(chatId, caption, opts);
  }

  private async onEar(line: string): Promise<void> {
    let ev: { event?: string; text?: string; error?: string; fatal?: boolean; device?: string; model?: string };
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    switch (ev.event) {
      case "ready":
        this.log(`ouvido pronto (microfone: ${ev.device ?? "?"}, whisper ${ev.model ?? "?"}) — diga "oi Jarvis"`);
        return;
      case "wake":
        this.interrupt();
        this.chime(SOUND_WAKE);
        return;
      case "interrupt":
        this.interrupt();
        return;
      case "heard":
        this.log(`(ouviu, sem ativação) ${ev.text ?? ""}`);
        return;
      case "error":
        this.log(`ouvido: ${ev.error ?? "erro"}`);
        return;
      case "command": {
        const text = (ev.text ?? "").trim();
        if (!text) return;
        this.log(`🎙️ ${text}`);
        this.interrupt();
        if (STOP.test(text)) {
          this.buttons = [];
          await this.cb?.({ senderId: this.id, chatId: this.id, text: "/parar", viaVoice: true });
          return;
        }
        const ans = answerFromSpeech(text, this.buttons);
        if (ans !== null) {
          this.buttons = [];
          this.chime(SOUND_ACK);
          await this.cb?.({ senderId: this.id, chatId: this.id, text: ans, viaVoice: true, isCallback: true });
          return;
        }
        this.chime(SOUND_ACK);
        // sem await: o gateway é reentrante (a próxima fala pode responder uma confirmação)
        void Promise.resolve(this.cb?.({ senderId: this.id, chatId: this.id, text: `${VOICE_HINT}\n${text}`, viaVoice: true })).catch((e) =>
          this.log(`tarefa falhou: ${e instanceof Error ? e.message : String(e)}`),
        );
        return;
      }
    }
  }

  private spawnEar(): void {
    const sp = this.o.spawnFn ?? spawn;
    const p = sp(this.o.python, ["-I", this.o.earScript], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(this.o.earEnv ?? {}) } });
    this.ear = p;
    createInterface({ input: p.stdout! }).on("line", (l) => void this.onEar(l));
    createInterface({ input: p.stderr! }).on("line", (l) => {
      if (!/warn/i.test(l)) this.log(`ouvido stderr: ${l.slice(0, 200)}`);
    });
    p.on("exit", (code) => {
      this.ear = null;
      if (this.stopped) return;
      this.log(`ouvido saiu (código ${code}); religo em 3 s`);
      setTimeout(() => !this.stopped && this.spawnEar(), 3000).unref?.();
    });
  }

  start(): Promise<void> {
    this.stopped = false;
    this.spawnEar();
    // bloqueante como os outros canais: só resolve no stop()
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        if (this.stopped) {
          clearInterval(iv);
          resolve();
        }
      }, 1000);
    });
  }

  stop(): void {
    this.stopped = true;
    this.interrupt();
    this.ear?.kill("SIGTERM");
  }
}
