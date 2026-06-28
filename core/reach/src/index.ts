// core/reach/index.ts — superfície pública do pacote @typer/reach ("olhos na internet").

import type { ReachContext, ReachResult } from "./types.js";
import { routeUrl, getChannel } from "./registry.js";
import { fetchVia } from "./router.js";

export * from "./types.js";
export { tryBackends, fetchVia, probeChannel } from "./router.js";
export { CHANNELS, getChannel, routeUrl } from "./registry.js";
export { loadConfig, saveConfig, setCred, resolveCred } from "./store.js";
export { checkAll, formatReport, type ChannelReport } from "./doctor.js";
export { htmlToText, decodeEntities, fetchText } from "./http.js";
export { parseFeed, type FeedItem } from "./channels/rss.js";
export { parseVideoId, parseTimedText } from "./channels/youtube.js";
export { parseRepo } from "./channels/github.js";

/** Lê uma URL roteando o canal certo (youtube→transcrição, github→repo, ...→web). */
export function reachRead(input: string, ctx: ReachContext): Promise<ReachResult> {
  return fetchVia(routeUrl(input), input, ctx);
}

/** Lê via um canal específico pelo nome. */
export async function reachChannel(name: string, input: string, ctx: ReachContext): Promise<ReachResult> {
  const ch = getChannel(name);
  if (!ch) return { ok: false, error: { code: "no_channel", message: `canal desconhecido: ${name}` } };
  return fetchVia(ch, input, ctx);
}

/** Busca na web (Exa/DDG). */
export function reachSearch(query: string, ctx: ReachContext): Promise<ReachResult> {
  return reachChannel("search", query, ctx);
}
