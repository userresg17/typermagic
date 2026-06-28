// core/reach/channels/reddit.ts
// Canal Reddit. Backends:
//   1) public — API JSON pública (.json no fim da URL). Funciona SEM login p/ conteúdo
//      público — robusto. Reddit exige um User-Agent próprio (senão 429).
//   2) cookie — mesma API com o cookie de sessão (reddit_cookie), p/ conteúdo gateado.

import type { Backend, Channel, ReachContext, ReachResult } from "../types.js";
import { fetchText } from "../http.js";
import { resolveCred } from "../store.js";

function jsonUrl(input: string): string {
  const u = new URL(input);
  const path = u.pathname.replace(/\/$/, "");
  return `https://www.reddit.com${path}.json?limit=40&raw_json=1`;
}

interface RedditPost {
  title?: string;
  selftext?: string;
  author?: string;
  subreddit?: string;
  score?: number;
  permalink?: string;
  url?: string;
}
interface Listing {
  data?: { children?: { data?: RedditPost & { body?: string } }[] };
}

/** Formata a resposta JSON do Reddit (thread = array; subreddit = listing). */
export function formatReddit(json: unknown): string {
  if (Array.isArray(json)) {
    const post = (json[0] as Listing).data?.children?.[0]?.data ?? {};
    const comments = (json[1] as Listing).data?.children ?? [];
    const head = `# ${post.title ?? "(sem título)"}\nr/${post.subreddit ?? "?"} · u/${post.author ?? "?"} · ${post.score ?? 0}↑`;
    const body = post.selftext ? `\n\n${post.selftext}` : post.url ? `\n\n${post.url}` : "";
    const top = comments
      .slice(0, 12)
      .map((c) => c.data)
      .filter((c) => c?.body)
      .map((c) => `- **u/${c!.author}** (${c!.score ?? 0}↑): ${c!.body!.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n");
    return `${head}${body}${top ? `\n\n## Comentários\n${top}` : ""}`;
  }
  const children = (json as Listing).data?.children ?? [];
  return children
    .map((c) => c.data)
    .filter(Boolean)
    .map((p) => `- **${p!.title}** (${p!.score ?? 0}↑) — https://reddit.com${p!.permalink ?? ""}`)
    .join("\n");
}

// UA de navegador: o Reddit bloqueia UAs "de bot" e muitos IPs de datacenter (403).
// Em IP residencial costuma passar; gateado/bloqueado → use o cookie (reach login reddit).
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

async function fetchReddit(input: string, ctx: ReachContext, cookie?: string): Promise<ReachResult> {
  const r = await fetchText(jsonUrl(input), {
    timeoutMs: ctx.timeoutMs,
    headers: { "user-agent": UA, accept: "application/json", ...(cookie ? { cookie } : {}) },
  });
  if (r.status >= 400) return { ok: false, error: { code: "reddit_failed", message: `status ${r.status}` } };
  try {
    const md = formatReddit(JSON.parse(r.text));
    return md ? { ok: true, content: md } : { ok: false, error: { code: "empty", message: "sem conteúdo" } };
  } catch (e) {
    return { ok: false, error: { code: "parse_failed", message: (e as Error).message } };
  }
}

const publicBackend: Backend = {
  name: "public",
  available: () => true,
  run: (input, ctx) => fetchReddit(input, ctx),
};

const cookieBackend: Backend = {
  name: "cookie",
  available: (ctx) => !!resolveCred(ctx.config, "reddit_cookie"),
  run: (input, ctx) => fetchReddit(input, ctx, resolveCred(ctx.config, "reddit_cookie")),
};

export const redditChannel: Channel = {
  name: "reddit",
  description: "Ler posts/threads e subreddits do Reddit",
  tier: "login",
  backends: [publicBackend, cookieBackend],
  matches: (input) => /reddit\.com/i.test(input),
};
