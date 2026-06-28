// core/reach/channels/twitter.ts
// Canal Twitter/X. Backend principal robusto SEM login: endpoint público de
// "syndication" (o mesmo que o embed de tweet usa). Tweets gateados/privados
// precisariam de login autenticado (GraphQL com cookie) — frágil; fica p/ um backend
// futuro. Para o caso comum (tweet público), o syndication resolve.

import type { Backend, Channel } from "../types.js";
import { fetchText } from "../http.js";

export function parseTweetId(input: string): string | null {
  if (/^\d{5,25}$/.test(input)) return input;
  const m = input.match(/(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/i);
  return m ? m[1]! : null;
}

/** Token do endpoint de syndication (mesmo cálculo do react-tweet). */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

interface SyndTweet {
  text?: string;
  user?: { name?: string; screen_name?: string };
  favorite_count?: number;
  created_at?: string;
}

const syndicationBackend: Backend = {
  name: "syndication",
  available: () => true,
  run: async (input, ctx) => {
    const id = parseTweetId(input);
    if (!id) return { ok: false, error: { code: "bad_url", message: "URL de tweet inválida" } };
    const token = syndicationToken(id);
    const r = await fetchText(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
    });
    if (r.status >= 400) return { ok: false, error: { code: "twitter_failed", message: `status ${r.status}` } };
    let j: SyndTweet;
    try {
      j = JSON.parse(r.text) as SyndTweet;
    } catch (e) {
      return { ok: false, error: { code: "parse_failed", message: (e as Error).message } };
    }
    if (!j.text) return { ok: false, error: { code: "not_found", message: "tweet não encontrado ou protegido" } };
    const md = `**${j.user?.name ?? "?"} (@${j.user?.screen_name ?? "?"})**${
      j.created_at ? ` · ${j.created_at}` : ""
    }\n\n${j.text}\n\n♥ ${j.favorite_count ?? 0}`;
    return { ok: true, content: md, meta: { id } };
  },
};

export const twitterChannel: Channel = {
  name: "twitter",
  description: "Ler tweets do Twitter/X (público)",
  tier: "login",
  backends: [syndicationBackend],
  matches: (input) => /(?:twitter\.com|x\.com)\//i.test(input),
};
