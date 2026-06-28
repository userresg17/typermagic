// app/gateway/fake.ts
// Canal Fake — injeta mensagens em memória e captura as respostas. Testável offline,
// sem rede. É o que prova o gateway end-to-end sem um bot real.

import type { ChannelAdapter, IncomingMessage } from "./types.js";

export class FakeChannel implements ChannelAdapter {
  readonly name = "fake";
  readonly sent: Array<{ chatId: string; text: string }> = [];
  private cb: ((m: IncomingMessage) => void | Promise<void>) | undefined;

  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void {
    this.cb = cb;
  }

  async send(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
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
