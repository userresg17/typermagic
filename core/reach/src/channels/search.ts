// core/reach/channels/search.ts
// Canal de busca: busca semântica/web. Backends:
//   1) exa — api.exa.ai (precisa EXA_API_KEY; melhor qualidade, semântico)
//   2) ddg — DuckDuckGo HTML (sem chave, fallback best-effort)
// Não casa URL (matches=false): é invocado direto (reach_search / reach search).

import type { Backend, Channel } from "../types.js";
import { fetchText, decodeEntities } from "../http.js";
import { resolveCred } from "../store.js";

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
}

const exaBackend: Backend = {
  name: "exa",
  available: (ctx) => !!resolveCred(ctx.config, "exa_api_key"),
  run: async (query, ctx) => {
    const key = resolveCred(ctx.config, "exa_api_key");
    if (!key) return { ok: false, error: { code: "no_key", message: "sem EXA_API_KEY" } };
    const r = await fetchText("https://api.exa.ai/search", {
      method: "POST",
      timeoutMs: ctx.timeoutMs,
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, numResults: 6, contents: { text: { maxCharacters: 600 } } }),
    });
    if (r.status >= 400) return { ok: false, error: { code: "exa_failed", message: `status ${r.status}` } };
    const results = (JSON.parse(r.text) as { results?: ExaResult[] }).results ?? [];
    if (!results.length) return { ok: false, error: { code: "no_results", message: "sem resultados" } };
    const md = results
      .map((x) => `- **${x.title ?? x.url}** — ${x.url}${x.text ? `\n  ${x.text.replace(/\s+/g, " ").slice(0, 300)}` : ""}`)
      .join("\n");
    return { ok: true, content: md, meta: { count: results.length } };
  },
};

const ddgBackend: Backend = {
  name: "ddg",
  available: () => true,
  run: async (query, ctx) => {
    const r = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "user-agent": "Mozilla/5.0 (compatible; typer-reach/1.0)" },
    });
    if (r.status >= 400) return { ok: false, error: { code: "ddg_failed", message: `status ${r.status}` } };
    const hits = [...r.text.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .slice(0, 8)
      .map((m) => ({ url: decodeEntities(m[1]!), title: decodeEntities(m[2]!.replace(/<[^>]+>/g, "")).trim() }));
    if (!hits.length) return { ok: false, error: { code: "no_results", message: "sem resultados" } };
    const md = hits.map((h) => `- **${h.title}** — ${h.url}`).join("\n");
    return { ok: true, content: md, meta: { count: hits.length } };
  },
};

export const searchChannel: Channel = {
  name: "search",
  description: "Busca na web (Exa semântico, ou DuckDuckGo)",
  tier: "zero-config",
  backends: [exaBackend, ddgBackend],
  matches: () => false,
};
