// app/gateway/telegram.ts
// Canal Telegram REAL — Bot API por long-polling (getUpdates) via fetch nativo,
// zero dependência. Acende com o token do @BotFather em TYPER_TELEGRAM_TOKEN (padrão
// BYOK). O token nunca vai ao repo. Cada mensagem vira IncomingMessage com o id do
// remetente (allowlist/rate-limit do gateway operam por aqui).

import type { ChannelAdapter, IncomingMessage } from "./types.js";

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    from?: { id: number };
    chat?: { id: number };
  };
}

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";
  private offset = 0;
  private running = false;
  private cb: ((m: IncomingMessage) => void | Promise<void>) | undefined;

  constructor(private readonly token: string) {
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
        if (m?.text && m.from && m.chat) {
          // fire-and-forget: NÃO bloqueia o loop. Assim, enquanto uma tarefa fica suspensa
          // esperando uma confirmação do usuário, a PRÓXIMA mensagem (o "SIM") é lida e
          // roteada p/ a pendência. handle() já trata seus próprios erros.
          void Promise.resolve(
            this.cb?.({ senderId: String(m.from.id), chatId: String(m.chat.id), text: m.text }),
          ).catch(() => {
            /* evita unhandledRejection; handle() audita o erro */
          });
        }
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
