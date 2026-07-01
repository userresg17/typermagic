// app/gateway/types.ts
// Contrato de um canal de mensagens. O gateway não sabe se é Telegram, Discord ou
// um Fake — só recebe mensagens e responde. Cada canal vira uma superfície
// gateway:<name> sobre a Engine, capability-scoped (READONLY por padrão).

import type { CapabilityGrant, EngineFeatures } from "@typer/engine";
import type { BrowserOptions } from "@typer/agent";

export interface IncomingMessage {
  /** id do remetente (allowlist/rate-limit por aqui) */
  senderId: string;
  /** id do chat p/ responder */
  chatId: string;
  text: string;
  /** a mensagem veio como ÁUDIO (foi transcrita) — p/ responder por voz na Fase 4. */
  viaVoice?: boolean;
}

export interface ChannelAdapter {
  /** nome curto do canal — vira a superfície gateway:<name> */
  readonly name: string;
  /** registra o handler de mensagens recebidas */
  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void;
  /** envia uma resposta ao chat */
  send(chatId: string, text: string): Promise<void>;
  /** envia uma resposta em ÁUDIO (voz-OUT). Opcional — canais sem voz não implementam. */
  sendVoice?(chatId: string, audioPath: string): Promise<void>;
  /** começa a escutar (bloqueante p/ canais reais; no-op no Fake) */
  start(): Promise<void>;
  /** para de escutar */
  stop(): void;
}

export interface GatewayConfig {
  root: string;
  /** remetentes autorizados; VAZIO = ninguém (default-deny seguro) */
  allow: string[];
  /** grant por remetente (default = READONLY da superfície) */
  grants?: Record<string, CapabilityGrant>;
  /** rate-limit: capacidade do balde e refil */
  rateCapacity?: number;
  rateRefillMs?: number;
  provider?: string | null;
  local?: boolean;
  features?: EngineFeatures;
  /** habilita o navegador real (Playwright) compartilhado p/ as tarefas. Ausente = sem
   *  browser. Anti-bot: channel:"chrome" (Chrome instalado) ou cdpUrl (conecta ao Chrome
   *  já aberto do usuário). headful + cdpUrl é o mais difícil de detectar. */
  browser?: BrowserOptions;
  /** habilita o cofre cifrado (vault_fill) — abre ~/.typer/vault.enc sob demanda. */
  vault?: boolean;
}
