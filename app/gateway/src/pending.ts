// app/gateway/pending.ts
// "Perguntar e esperar": quando o agente precisa de algo do usuário (aprovação,
// esclarecimento de pedido, ou um código/OTP), a tarefa suspende e registra a pendência
// aqui. A PRÓXIMA mensagem daquele chat resolve a Promise — é o que torna o gateway
// reentrante (o loop de polling não trava esperando a resposta). Uma pendência por chat
// (fluxo sequencial); timeout → rejeita (default-deny: na dúvida, não age).

export type PendingKind = "approval" | "clarify" | "otp";

interface Pending {
  kind: PendingKind;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingStore {
  private readonly map = new Map<string, Pending>();

  /** Há uma pergunta aguardando resposta neste chat? */
  has(chatId: string): boolean {
    return this.map.has(chatId);
  }

  /** Registra uma pendência e devolve a Promise da resposta do usuário.
   *  Substitui (cancela) qualquer pendência anterior do mesmo chat. */
  wait(chatId: string, kind: PendingKind, timeoutMs: number): Promise<string> {
    this.cancel(chatId, "substituída por uma nova pergunta");
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.map.delete(chatId);
        reject(new Error("timeout: usuário não respondeu a tempo"));
      }, timeoutMs);
      // não segura o event loop vivo só por causa do timer
      (timer as { unref?: () => void }).unref?.();
      this.map.set(chatId, { kind, resolve, reject, timer });
    });
  }

  /** Resolve a pendência do chat com a resposta. Devolve true se havia o que resolver. */
  resolve(chatId: string, answer: string): boolean {
    const p = this.map.get(chatId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.map.delete(chatId);
    p.resolve(answer);
    return true;
  }

  /** Cancela (rejeita) a pendência do chat, se houver (ex.: nova pergunta, shutdown). */
  cancel(chatId: string, reason: string): void {
    const p = this.map.get(chatId);
    if (!p) return;
    clearTimeout(p.timer);
    this.map.delete(chatId);
    p.reject(new Error(reason));
  }
}
