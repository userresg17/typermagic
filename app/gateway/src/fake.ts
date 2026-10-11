// app/gateway/fake.ts
// Canal Fake — injeta mensagens em memória e captura as respostas. Testável offline,
// sem rede. É o que prova o gateway end-to-end sem um bot real.

import type { ChannelAdapter, IncomingMessage, SendOptions } from "./types.js";

export class FakeChannel implements ChannelAdapter {
  readonly name = "fake";
  readonly sent: Array<{ chatId: string; text: string; buttons?: SendOptions["buttons"] }> = [];
  readonly photos: Array<{ chatId: string; png: string; caption?: string; buttons?: SendOptions["buttons"] }> = [];
  private cb: ((m: IncomingMessage) => void | Promise<void>) | undefined;

  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void {
    this.cb = cb;
  }

  async send(chatId: string, text: string, opts?: SendOptions): Promise<void> {
    this.sent.push({ chatId, text, ...(opts?.buttons ? { buttons: opts.buttons } : {}) });
  }

  async sendPhoto(chatId: string, png: string, caption?: string, opts?: SendOptions): Promise<void> {
    this.photos.push({ chatId, png, ...(caption !== undefined ? { caption } : {}), ...(opts?.buttons ? { buttons: opts.buttons } : {}) });
  }

  async start(): Promise<void> {
    /* no-op: mensagens chegam por inject() */
  }

  stop(): void {
    /* no-op */
  }

  /** Helper de teste: injeta uma mensagem como se viesse do canal. */
  async inject(m: IncomingMessage): Promise<void> {
    await this.cb?.(m);
  }

  /** Última resposta enviada (helper de teste). */
  lastReply(): string {
    return this.sent.at(-1)?.text ?? "";
  }
}
