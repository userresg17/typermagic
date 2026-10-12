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
  /** caixinha flutuante na tela (platform/voice/jarvis_hud.py): ausente = sem caixa */
  hud?: { python: string; script: string };
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
export const VOICE_HINT =
  "[Pedido falado ao Jarvis no Mac. Responda como fala natural e direta de brasileiro, curto: 1 a 3 frases, sem listas, tabelas, markdown, emojis ou links. Escreva horários só com dígitos no formato 22:34 (o sistema converte para fala); use vírgulas e pontos como uma pessoa respira ao falar.]";

const UNID = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** número por extenso (0–999). `fem` = concordância feminina: uma, duas, duzentas… */
export function extenso(n: number, fem = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  let out: string;
  if (n < 20) out = UNID[n]!;
  else if (n < 100) out = DEZ[Math.floor(n / 10)]! + (n % 10 ? ` e ${UNID[n % 10]}` : "");
  else if (n === 100) out = "cem";
  else out = CEM[Math.floor(n / 100)]! + (n % 100 ? ` e ${extenso(n % 100)}` : "");
  if (fem) out = out.replace(/\bum\b/g, "uma").replace(/\bdois\b/g, "duas").replace(/entos\b/g, "entas");
  return out;
}

const hora = (h: string): string => {
  const n = Number(h);
  if (n === 0) return "meia-noite";
  if (n === 12) return "meio-dia";
  return extenso(n, true);
};
const minuto = (m: string): string => extenso(Number(m));

/** substantivos femininos comuns nas respostas: o número antes deles vai no feminino */
const FEMININOS = "horas?|pessoas?|passagens?|vezes|semanas?|cartas?|noites?|opç(?:ão|ões)|malas?|parcelas?|unidades?|mensagens?|páginas?|tarefas?|abas?|janelas?|fotos?|compras?|reservas?|diárias?|camas?|vagas?|poltronas?|escalas?|conexões|ofertas?|lojas?";

/** hora e número no jeito que brasileiro FALA:
 *  "22:34" / "22h34" / "22 horas e 34 minutos" / "são 22 e 34" → "vinte e duas e trinta e quatro";
 *  "15:00" → "quinze em ponto"; "12:10" → "meio-dia e dez"; "2 pessoas" → "duas pessoas".
 *  Aplicado antes da síntese (o TTS lê dígito no masculino: "vinte e dois"). */
export function falaHora(t: string): string {
  const fmt = (h: string, m: string): string => (/^0+$/.test(m) ? `${hora(h)} em ponto` : `${hora(h)} e ${minuto(m)}`);
  return t
    .replace(/\b(\d{1,2})\s*horas?\s*e\s*(\d{1,2})\s*minutos?\b/gi, (_x, h: string, m: string) => fmt(h, m))
    .replace(/\b([01]?\d|2[0-3])\s*[:h]\s*([0-5]\d)\b(?:\s*min)?/gi, (_x, h: string, m: string) => fmt(h, m))
    .replace(/(?<!\p{L})(são|é|às|as|das|pelas|até as|desde as|a partir das)\s+([01]?\d|2[0-3])\s+e\s+([0-5]?\d)\b(?!\s*(?:reais|dólares|euros|%|por cento))/giu, (_x, pre: string, h: string, m: string) => `${pre} ${fmt(h, m)}`)
    .replace(/\b([01]?\d|2[0-3])\s*(?:horas?\s+)?em ponto\b/gi, (_x, h: string) => `${hora(h)} em ponto`)
    .replace(new RegExp(`\\b(\\d{1,3})\\s+(${FEMININOS})\\b`, "gi"), (_x, n: string, w: string) => `${extenso(Number(n), true)} ${w}`);
}

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
  private hudProc: ChildProcess | null = null;
  private inFlight = 0;

  constructor(private readonly o: JarvisOptions) {
    this.id = o.senderId ?? "jarvis";
  }

  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void {
    this.cb = cb;
  }

  private log(m: string): void {
    this.o.log?.(m);
  }

  /** atualiza a pílula na tela (listening | thinking | speaking | done | error). `extra.wav` = áudio
   *  que está começando a tocar (a onda segue o envelope dele); `extra.level` = nível do microfone. */
  hud(state: string | null, _text = "", extra: { wav?: string; level?: number } = {}): void {
    if (!this.o.hud) return;
    try {
      if (!this.hudProc || this.hudProc.exitCode !== null) {
        const sp = this.o.spawnFn ?? spawn;
        this.hudProc = sp(this.o.hud.python, ["-I", this.o.hud.script], { stdio: ["pipe", "ignore", "ignore"] });
        this.hudProc.on("error", () => (this.hudProc = null));
        this.hudProc.on("exit", () => (this.hudProc = null));
      }
      const msg = state === null ? { level: extra.level ?? 0 } : { state, ...(extra.wav ? { wav: extra.wav } : {}) };
      this.hudProc.stdin?.write(JSON.stringify(msg) + "\n");
    } catch {
      /* caixa é cosmética: nunca derruba a conversa */
    }
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
    const spoken = this.o.prepare(falaHora(text));
    if (!spoken) return Promise.resolve();
    const frases = this.o.split(spoken);
    const g = this.gen;
    this.log(`🔊 ${spoken.slice(0, 160)}${spoken.length > 160 ? "…" : ""}`);
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
        if (wav && g === this.gen) {
          this.hud("speaking", frases[i]!, { wav });
          await this.play(wav);
        }
        if (wav) void unlink(wav).catch(() => {});
      }
      if (next) void next.then((w) => { if (w) void unlink(w).catch(() => {}); });
    };
    this.queue = this.queue.then(job, job).finally(() => {
      this.pendingSpeech--;
      if (this.pendingSpeech === 0) {
        this.earSend({ cmd: "speaking", on: false });
        if (this.inFlight > 0) this.hud("thinking", "trabalhando no pedido…");
        else this.hud("done");
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
      // tarefa longa: a caixinha na tela já avisa (falar "tô vendo isso" toda vez cansava)
      this.hud("thinking", "trabalhando nisso — pode levar 1–2 min");
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
    let ev: { event?: string; text?: string; error?: string; fatal?: boolean; device?: string; model?: string; followup?: boolean };
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
        this.hud("listening", "pode falar");
        return;
      case "interrupt":
        this.interrupt();
        return;
      case "level":
        this.hud(null, "", { level: Number((ev as { v?: number }).v ?? 0) });
        return;
      case "heard":
        this.log(`(ouviu, sem ativação) ${ev.text ?? ""}`);
        return;
      case "error":
        this.log(`ouvido: ${ev.error ?? "erro"}`);
        return;
      case "command": {
        const text = (ev.text ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
        if (!text) return;
        this.log(`🎙️ ${text}`);
        this.interrupt();
        if (STOP.test(text)) {
          this.buttons = [];
          await this.cb?.({ senderId: this.id, chatId: this.id, text: "/parar", viaVoice: true });
          return;
        }
        // ruído/eco: fala de 1 palavra sem conteúdo ("E...", "Hã", "Ah") não vira pedido
        if (ev.followup && this.buttons.length === 0 && /^(e|é|ah|ahn|hã|hum|hm|uhum|né|tá|ok|o|a)\W*$/i.test(text)) {
          this.log(`(ignorado: ${text})`);
          this.hud("done");
          return;
        }
        const ans = answerFromSpeech(text, this.buttons);
        if (ans !== null) {
          this.buttons = [];
          this.chime(SOUND_ACK);
          this.hud("thinking", ans === "ok" ? "confirmado ✓" : "cancelado");
          await this.cb?.({ senderId: this.id, chatId: this.id, text: ans, viaVoice: true, isCallback: true });
          return;
        }
        this.chime(SOUND_ACK);
        this.hud("thinking", `“${text}”`);
        this.inFlight++;
        // sem await: o gateway é reentrante (a próxima fala pode responder uma confirmação)
        void Promise.resolve(this.cb?.({ senderId: this.id, chatId: this.id, text: `${VOICE_HINT}\n${text}`, viaVoice: true }))
          .catch((e) => {
            this.log(`tarefa falhou: ${e instanceof Error ? e.message : String(e)}`);
            this.hud("error", "a tarefa falhou — veja o Telegram/log");
          })
          .finally(() => {
            this.inFlight = Math.max(0, this.inFlight - 1);
            if (this.inFlight === 0 && this.pendingSpeech === 0) this.hud("done");
          });
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
    // aquece a voz (o XTTS carrega ~2 GB na 1ª síntese: sem isso a 1ª resposta demora ~20 s)
    const warm = join(tmpdir(), `jarvis-warm-${process.pid}.wav`);
    void this.o
      .synthToWav("Pronto.", warm)
      .then(() => this.log("voz aquecida"))
      .catch(() => {})
      .finally(() => void unlink(warm).catch(() => {}));
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
    this.hudProc?.stdin?.end();
    this.ear?.kill("SIGTERM");
  }
}
