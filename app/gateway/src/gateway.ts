// app/gateway/gateway.ts
// O motor do gateway. Por mensagem recebida: (1) allowlist por remetente (default-deny
// — remetente desconhecido é recusado), (2) rate-limit por remetente, (3) roda a tarefa
// pela Engine numa superfície gateway:<canal> CAPABILITY-SCOPED (READONLY por padrão,
// approval "never" → o policy gate NEGA ação irreversível sozinho), e (4) transmite a
// resposta de volta ao canal. O canal nunca herda o grant do terminal local.

import { createEngine, type CapabilityGrant, type EngineEvent } from "@typer/engine";
import { RateLimiter } from "./rate-limit.js";
import type { ChannelAdapter, GatewayConfig, IncomingMessage } from "./types.js";

export interface GatewayHooks {
  /** observabilidade: chamado a cada mensagem processada */
  onAudit?: (e: { sender: string; result: "ok" | "denied" | "rate_limited" | "error"; detail?: string }) => void;
}

export class Gateway {
  private readonly rate: RateLimiter;
  private readonly surface: `gateway:${string}`;

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly config: GatewayConfig,
    private readonly hooks: GatewayHooks = {},
  ) {
    this.rate = new RateLimiter(config.rateCapacity ?? 5, config.rateRefillMs ?? 4000);
    this.surface = `gateway:${adapter.name}`;
  }

  private allowed(sender: string): boolean {
    return this.config.allow.includes(sender);
  }

  private grantFor(sender: string): CapabilityGrant | undefined {
    // grant explícito por remetente (config) ou undefined → default da superfície (READONLY)
    return this.config.grants?.[sender];
  }

  /** Processa uma mensagem (allowlist → rate-limit → Engine → resposta). */
  async handle(msg: IncomingMessage): Promise<void> {
    const sender = msg.senderId;
    if (!this.allowed(sender)) {
      await this.adapter.send(msg.chatId, "⛔ Remetente não autorizado.");
      this.hooks.onAudit?.({ sender, result: "denied" });
      return;
    }
    if (!this.rate.allow(sender)) {
      await this.adapter.send(msg.chatId, "⏳ Muitas mensagens. Tente em instantes.");
      this.hooks.onAudit?.({ sender, result: "rate_limited" });
      return;
    }

    const grant = this.grantFor(sender);
    const engine = createEngine(
      {
        root: this.config.root,
        surface: this.surface,
        provider: this.config.provider ?? null,
        local: this.config.local ?? false,
        mode: "ask", // canal responde; não edita o repo
        approval: "never", // autônomo: o policy gate nega ação irreversível sozinho
        ...(grant ? { capabilities: grant } : {}),
        features: this.config.features ?? {},
      },
      { approve: () => false }, // gateway nunca auto-aprova ação que pediria selo humano
    );

    let buf = "";
    try {
      for await (const ev of engine.runTask({ prompt: msg.text })) {
        buf = this.fold(buf, ev);
      }
      this.hooks.onAudit?.({ sender, result: "ok" });
    } catch (err) {
      buf += `\n[erro: ${err instanceof Error ? err.message : String(err)}]`;
      this.hooks.onAudit?.({ sender, result: "error", detail: buf });
    } finally {
      await engine.dispose();
    }
    await this.adapter.send(msg.chatId, buf.trim() || "(sem resposta)");
  }

  private fold(buf: string, ev: EngineEvent): string {
    if (ev.type === "token") return buf + ev.text;
    if (ev.type === "policy" && ev.decision === "deny") return buf + `\n🔒 bloqueado: ${ev.reason ?? "política"}`;
    if (ev.type === "error") return buf + `\n[erro: ${ev.message}]`;
    return buf;
  }

  /** Liga o gateway ao canal e começa a escutar. */
  async start(): Promise<void> {
    this.adapter.onMessage((m) => this.handle(m));
    await this.adapter.start();
  }

  stop(): void {
    this.adapter.stop();
  }
}
