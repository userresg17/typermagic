// core/reach/channels/china.ts
// Canais focados na China (paridade com o agent-reach). Tiers honestos:
//   v2ex      — API REST pública (robusto, sem login)
//   bilibili  — API pública de metadados de vídeo (best-effort; legenda exige login)
//   xiaoyuzhou— shownotes do episódio (best-effort; transcrição via whisper = futuro)
//   xueqiu    — precisa cookie (xueqiu_cookie)
//   xiaohongshu — anti-scraping forte: cookie best-effort; caminho robusto é via MCP
//                 (xiaohongshu-mcp, registrado no `reach install`).

import type { Backend, Channel, ReachContext, ReachResult } from "../types.js";
import { fetchText, htmlToText } from "../http.js";
import { resolveCred } from "../store.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

// ---- v2ex (API pública) ----
const v2exBackend: Backend = {
  name: "api",
  available: () => true,
  run: async (input, ctx) => {
    const id = input.match(/\/t\/(\d+)/)?.[1] ?? (/^\d+$/.test(input) ? input : null);
    if (!id) return { ok: false, error: { code: "bad_url", message: "URL de tópico V2EX inválida" } };
    const topic = await fetchText(`https://www.v2ex.com/api/topics/show.json?id=${id}`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (topic.status >= 400) return { ok: false, error: { code: "v2ex_failed", message: `status ${topic.status}` } };
    try {
      const t = (JSON.parse(topic.text) as { title?: string; content?: string; member?: { username?: string } }[])[0];
      if (!t) return { ok: false, error: { code: "not_found", message: "tópico não encontrado" } };
      return { ok: true, content: `# ${t.title ?? ""}\n@${t.member?.username ?? "?"}\n\n${t.content ?? ""}` };
    } catch (e) {
      return { ok: false, error: { code: "parse_failed", message: (e as Error).message } };
    }
  },
};
export const v2exChannel: Channel = {
  name: "v2ex",
  description: "Ler tópicos do V2EX (API pública)",
  tier: "zero-config",
  backends: [v2exBackend],
  matches: (input) => /v2ex\.com/i.test(input),
};

// ---- bilibili (metadados públicos) ----
const biliBackend: Backend = {
  name: "api",
  available: () => true,
  run: async (input, ctx) => {
    const bvid = input.match(/(BV[\w]+)/)?.[1];
    if (!bvid) return { ok: false, error: { code: "bad_url", message: "BVID não encontrado" } };
    const r = await fetchText(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "user-agent": UA, referer: "https://www.bilibili.com/", accept: "application/json" },
    });
    if (r.status >= 400) return { ok: false, error: { code: "bili_failed", message: `status ${r.status}` } };
    try {
      const d = (JSON.parse(r.text) as { data?: { title?: string; desc?: string; owner?: { name?: string } } }).data;
      if (!d) return { ok: false, error: { code: "not_found", message: "vídeo não encontrado" } };
      return { ok: true, content: `# ${d.title ?? ""}\nUP: ${d.owner?.name ?? "?"}\n\n${d.desc ?? ""}` };
    } catch (e) {
      return { ok: false, error: { code: "parse_failed", message: (e as Error).message } };
    }
  },
};
export const bilibiliChannel: Channel = {
  name: "bilibili",
  description: "Metadados de vídeo do Bilibili",
  tier: "zero-config",
  backends: [biliBackend],
  matches: (input) => /bilibili\.com|b23\.tv/i.test(input),
};

// ---- helper: canal best-effort que lê a página (com cookie opcional) ----
function pageChannel(opts: {
  name: string;
  description: string;
  match: RegExp;
  cookieKey?: string;
}): Channel {
  const backend: Backend = {
    name: opts.cookieKey ? "cookie" : "page",
    available: (ctx: ReachContext) => (opts.cookieKey ? !!resolveCred(ctx.config, opts.cookieKey) : true),
    run: async (input, ctx): Promise<ReachResult> => {
      const cookie = opts.cookieKey ? resolveCred(ctx.config, opts.cookieKey) : undefined;
      const r = await fetchText(input, {
        timeoutMs: ctx.timeoutMs,
        headers: { "user-agent": UA, ...(cookie ? { cookie } : {}) },
      });
      if (r.status >= 400) return { ok: false, error: { code: "failed", message: `status ${r.status}` } };
      const text = htmlToText(r.text);
      return text.length > 120
        ? { ok: true, content: text.slice(0, 100_000) }
        : { ok: false, error: { code: "blocked", message: `${opts.name}: bloqueado/JS — use cookie ou MCP` } };
    },
  };
  return {
    name: opts.name,
    description: opts.description,
    tier: opts.cookieKey ? "login" : "zero-config",
    backends: [backend],
    matches: (input) => opts.match.test(input),
  };
}

export const xiaoyuzhouChannel = pageChannel({
  name: "xiaoyuzhou",
  description: "Shownotes de podcast (XiaoYuZhou)",
  match: /xiaoyuzhoufm\.com/i,
});
export const xueqiuChannel = pageChannel({
  name: "xueqiu",
  description: "XueQiu (precisa cookie)",
  match: /xueqiu\.com/i,
  cookieKey: "xueqiu_cookie",
});
export const xiaohongshuChannel = pageChannel({
  name: "xiaohongshu",
  description: "XiaoHongShu (cookie best-effort; robusto via MCP)",
  match: /xiaohongshu\.com|xhslink\.com/i,
  cookieKey: "xiaohongshu_cookie",
});
