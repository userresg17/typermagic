// app/gateway/index.ts — superfície pública do @typer/gateway.

export { Gateway, type GatewayHooks } from "./gateway.js";
export { FakeChannel } from "./fake.js";
export { TelegramChannel } from "./telegram.js";
export { RateLimiter } from "./rate-limit.js";
export { PendingStore, type PendingKind } from "./pending.js";
export type { ChannelAdapter, IncomingMessage, GatewayConfig } from "./types.js";
