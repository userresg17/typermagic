// core/mcp/jsonrpc.ts
// Cliente JSON-RPC 2.0 sobre mensagens delimitadas por linha (framing do MCP por
// stdio). Separado do transporte para ser testável sem subprocesso: alimente
// feed() com bytes e correlacione respostas por id. É a parte com lógica; o
// StdioMcpServer é só a cola com o child_process.

type Send = (line: string) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** Handlers do LADO de entrada (torna o endpoint bidirecional, sem quebrar o uso
 *  cliente-só: ambos opcionais; ausentes → mensagens de entrada são ignoradas). */
export interface JsonRpcHandlers {
  /** request recebido (tem method + id): retorne o result (ou lance p/ erro) */
  onRequest?: (method: string, params: unknown) => Promise<unknown> | unknown;
  /** notificação recebida (tem method, sem id) */
  onNotify?: (method: string, params: unknown) => void;
}

export class JsonRpcEndpoint {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = "";

  constructor(
    private readonly send: Send,
    private readonly handlers: JsonRpcHandlers = {},
  ) {}

  /** Alimenta dados crus do transporte; processa cada linha completa. */
  feed(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch {
      return; // linha inválida: ignora (logs do servidor, etc.)
    }

    // Mensagem de ENTRADA (tem method): request (com id) ou notificação (sem id).
    if (typeof msg.method === "string") {
      if (typeof msg.id === "number") this.dispatchRequest(msg.id, msg.method, msg.params);
      else this.handlers.onNotify?.(msg.method, msg.params);
      return;
    }

    // Caso contrário, é uma RESPOSTA a um request nosso: correlaciona por id.
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(msg.error.message ?? `erro JSON-RPC ${msg.error.code}`));
    } else {
      p.resolve(msg.result);
    }
  }

  private dispatchRequest(id: number, method: string, params: unknown): void {
    if (!this.handlers.onRequest) return; // sem handler: ignora (cliente-só)
    void (async () => {
      try {
        const result = await this.handlers.onRequest!(method, params);
        this.send(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.send(
          JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) +
            "\n",
        );
      }
    })();
  }

  /** Envia um pedido e resolve com o result correlacionado por id. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }

  /** Envia uma notificação (sem id, sem resposta). */
  notify(method: string, params?: unknown): void {
    this.send(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Rejeita todos os pedidos pendentes (no fechamento/erro do transporte). */
  fail(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
