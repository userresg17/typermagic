// core/reach/channels/rss.ts
// Canal RSS/Atom: baixa um feed e lista os itens (título, link, resumo). Parser
// mínimo por regex (sem dep), tolerante a RSS 2.0 e Atom.

import type { Backend, Channel } from "../types.js";
import { fetchText, decodeEntities, htmlToText } from "../http.js";

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return decodeEntities(m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

/** Extrai itens de RSS (<item>) ou Atom (<entry>). */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
  return blocks.map((b) => {
    const title = tag(b, "title");
    // RSS usa <link>texto</link>; Atom usa <link href="...">
    let link = tag(b, "link");
    if (!link) {
      const href = b.match(/<link[^>]*href="([^"]+)"/i);
      link = href ? href[1]! : "";
    }
    const raw = tag(b, "description") || tag(b, "summary") || tag(b, "content");
    return { title, link, summary: htmlToText(raw).slice(0, 500) };
  });
}

const rssBackend: Backend = {
  name: "rss",
  available: () => true,
  run: async (url, ctx) => {
    const r = await fetchText(url, {
      timeoutMs: ctx.timeoutMs,
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    });
    if (r.status >= 400) return { ok: false, error: { code: "fetch_failed", message: `status ${r.status}` } };
    const items = parseFeed(r.text);
    if (!items.length) return { ok: false, error: { code: "not_a_feed", message: "sem itens RSS/Atom" } };
    const md = items
      .map((i) => `- **${i.title || "(sem título)"}**${i.link ? ` — ${i.link}` : ""}${i.summary ? `\n  ${i.summary}` : ""}`)
      .join("\n");
    return { ok: true, content: md, meta: { count: items.length, url } };
  },
};

export const rssChannel: Channel = {
  name: "rss",
  description: "Ler feeds RSS/Atom (lista de itens)",
  tier: "zero-config",
  backends: [rssBackend],
  matches: (input) => /\.(rss|atom)(\?|$)|\/(rss|atom|feed)(\.|\/|\?|$)/i.test(input),
};
