// app/gateway/types.ts
// Contrato de um canal de mensagens. O gateway não sabe se é Telegram, Discord ou
// um Fake — só recebe mensagens e responde. Cada canal vira uma superfície
// gateway:<name> sobre a Engine, capability-scoped (READONLY por padrão).

import type { CapabilityGrant, EngineFeatures } from "@typer/engine";
import type { BrowserOptions, BrowserSession, DesktopSession } from "@typer/agent";
import type { MeetingsHub } from "@typer/meetings";

export interface IncomingMessage {
  /** id do remetente (allowlist/rate-limit por aqui) */
  senderId: string;
  /** id do chat p/ responder */
  chatId: string;
  text: string;
  /** a mensagem veio como ÁUDIO (foi transcrita) — p/ responder por voz na Fase 4. */
  viaVoice?: boolean;
  /** veio de um BOTÃO inline (callback_query) — text = data do botão ("ok"/"cancel") */
  isCallback?: boolean;
  /** documento de texto anexado (.txt/.md/.vtt…), já baixado — p/ transcrição encaminhada como arquivo */
  document?: { name: string; text: string };
}

/** botão inline: rótulo + dado devolvido no callback */
export interface Button {
  text: string;
  data: string;
}
export interface SendOptions {
  /** linhas de botões inline */
  buttons?: Button[][];
}

export interface ChannelAdapter {
  /** nome curto do canal — vira a superfície gateway:<name> */
  readonly name: string;
  /** registra o handler de mensagens recebidas */
  onMessage(cb: (m: IncomingMessage) => void | Promise<void>): void;
  /** envia uma resposta ao chat (opcionalmente com botões inline) */
  send(chatId: string, text: string, opts?: SendOptions): Promise<void>;
  /** envia uma FOTO (PNG base64) com legenda — screenshots de checkpoint/handoff. Opcional. */
  sendPhoto?(chatId: string, pngBase64: string, caption?: string, opts?: SendOptions): Promise<void>;
  /** envia uma resposta em ÁUDIO (voz-OUT), com o texto JUNTO como legenda. Opcional. */
  sendVoice?(chatId: string, audioPath: string, caption?: string): Promise<void>;
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
  /** fábrica do navegador (macOS: CDP sem stealth). Ausente = openBrowser(config.browser). */
  openBrowser?: () => Promise<BrowserSession>;
  /** system prompt do sub-agente de navegador (macOS: handoff em vez de anti-bot) */
  browserPrompt?: string;
  /** controle de DESKTOP (macOS): fábrica da Platform. Ausente = sem desktop_*. */
  openDesktop?: () => DesktopSession;
  /** override de modelo (ex.: claude-opus-5-5) */
  model?: string | null;
  /** a cada quantos passos manda screenshot de checkpoint (default 5) */
  checkpointEvery?: number;
  /** Central de Reuniões: ingestão do que chega com "reunião" (WhatsApp → Telegram), comando
   *  /reunioes e as ferramentas reunioes_* p/ o agente responder perguntas. Ausente = desligada. */
  meetings?: MeetingsHub;
}
