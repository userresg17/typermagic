// app/gateway/telegram.ts
// Canal Telegram REAL — Bot API por long-polling (getUpdates) via fetch nativo,
// zero dependência. Acende com o token do @BotFather em TYPER_TELEGRAM_TOKEN (padrão
// BYOK). O token nunca vai ao repo. Cada mensagem vira IncomingMessage com o id do
// remetente (allowlist/rate-limit do gateway operam por aqui).

import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink, readFile } from "node:fs/promises";
import type { ChannelAdapter, IncomingMessage } from "./types.js";

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    voice?: { file_id: string; duration?: number };
    from?: { id: number };
    chat?: { id: number };
  };
}

/** transcrição de áudio (voz-IN) injetada pelo comando gateway (usa @typer/voice, tudo local). */
export interface VoiceHook {
  transcribe: (audioPath: string) => Promise<string>;
}

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";
  private offset = 0;
  private running = false;
  private cb: ((m: IncomingMessage) => void | Promise<void>) | undefined;

  constructor(
    private readonly token: string,
    private readonly voice?: VoiceHook,
  ) {
    if (!token) throw new Error("TelegramChannel requer um token (TYPER_TELEGRAM_TOKEN)");
  }

  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void {
    this.cb = cb;
  }

  private api(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private async getUpdates(): Promise<TgUpdate[]> {
    const res = await fetch(`${this.api("getUpdates")}?timeout=30&offset=${this.offset}`);
    const json = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
    return json.ok && json.result ? json.result : [];
  }

  async send(chatId: string, text: string): Promise<void> {
    await fetch(this.api("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    });
  }

  /** VOZ-OUT: envia um OGG/Opus como voz nativa, com o texto JUNTO na legenda (caption ≤ 1024). */
  async sendVoice(chatId: string, audioPath: string, caption?: string): Promise<void> {
    const buf = await readFile(audioPath);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("voice", new Blob([buf], { type: "audio/ogg" }), "voice.ogg");
    if (caption) form.append("caption", caption.slice(0, 1024));
    await fetch(this.api("sendVoice"), { method: "POST", body: form });
  }

  /** VOZ-IN: baixa o áudio, transcreve LOCAL, confirma o que ouviu e roteia como texto. */
  private async handleVoice(fileId: string, senderId: string, chatId: string): Promise<void> {
    let path = "";
    try {
      path = await this.downloadTgFile(fileId);
      const text = (await this.voice!.transcribe(path)).trim();
      if (!text) {
        await this.send(chatId, "🎙️ não entendi o áudio, pode repetir?");
        return;
      }
      await this.send(chatId, `🎙️ ouvi: "${text.slice(0, 300)}"`);
      await Promise.resolve(this.cb?.({ senderId, chatId, text, viaVoice: true })).catch(() => {});
    } catch {
      await this.send(chatId, "🎙️ não consegui processar o áudio.").catch(() => {});
    } finally {
      if (path) await unlink(path).catch(() => {});
    }
  }

  /** baixa um arquivo do Telegram (getFile → download binário) p/ um caminho temporário. */
  private async downloadTgFile(fileId: string): Promise<string> {
    const meta = (await (await fetch(`${this.api("getFile")}?file_id=${fileId}`)).json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    const fp = meta.result?.file_path;
    if (!fp) throw new Error("getFile não retornou file_path");
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${fp}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = fp.includes(".") ? fp.slice(fp.lastIndexOf(".")) : ".oga";
    const out = join(tmpdir(), `tg-voice-${Date.now()}-${this.offset}${ext}`);
    await writeFile(out, buf);
    return out;
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      let updates: TgUpdate[] = [];
      try {
        updates = await this.getUpdates();
      } catch {
        // erro de rede transitório: espera e tenta de novo
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      for (const u of updates) {
        this.offset = u.update_id + 1;
        const m = u.message;
        if (!m?.from || !m.chat) continue;
        const senderId = String(m.from.id);
        const chatId = String(m.chat.id);
        // fire-and-forget: NÃO bloqueia o loop. Assim, enquanto uma tarefa fica suspensa
        // esperando uma confirmação, a PRÓXIMA mensagem (o "SIM") é lida. handle() audita erros.
        if (m.voice && this.voice) {
          // VOZ: baixa o áudio, transcreve LOCAL e roteia como texto.
          void this.handleVoice(m.voice.file_id, senderId, chatId).catch(() => {});
        } else if (m.text) {
          void Promise.resolve(this.cb?.({ senderId, chatId, text: m.text })).catch(() => {});
        }
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
