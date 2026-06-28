// core/reach/registry.ts
// Registro dos canais + roteamento por URL. A ordem importa: canais específicos antes
// do web (catch-all). search não casa URL (é invocado direto).

import type { Channel } from "./types.js";
import { webChannel } from "./channels/web.js";
import { rssChannel } from "./channels/rss.js";
import { youtubeChannel } from "./channels/youtube.js";
import { githubChannel } from "./channels/github.js";
import { searchChannel } from "./channels/search.js";
import { redditChannel } from "./channels/reddit.js";
import { twitterChannel } from "./channels/twitter.js";
import { linkedinChannel } from "./channels/linkedin.js";
import {
  v2exChannel,
  bilibiliChannel,
  xiaoyuzhouChannel,
  xueqiuChannel,
  xiaohongshuChannel,
} from "./channels/china.js";

export const CHANNELS: Channel[] = [
  youtubeChannel,
  githubChannel,
  redditChannel,
  twitterChannel,
  linkedinChannel,
  bilibiliChannel,
  v2exChannel,
  xiaoyuzhouChannel,
  xueqiuChannel,
  xiaohongshuChannel,
  rssChannel,
  searchChannel,
  webChannel,
];

export function getChannel(name: string): Channel | undefined {
  return CHANNELS.find((c) => c.name === name);
}

/** Casa uma URL/entrada ao canal certo; default = web. */
export function routeUrl(input: string): Channel {
  for (const c of CHANNELS) {
    if (c === webChannel) continue;
    try {
      if (c.matches(input)) return c;
    } catch {
      /* canal com matcher problemático: tenta o próximo */
    }
  }
  return webChannel;
}
