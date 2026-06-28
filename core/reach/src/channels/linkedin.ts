// core/reach/channels/linkedin.ts
// Canal LinkedIn — gateado: precisa do cookie de sessão (li_at). Sem cookie, o canal
// fica "needs-config" no doctor. Mesmo com cookie é best-effort (LinkedIn é pesado de
// JS e anti-scraping); o caminho completo é via MCP (linkedin-scraper) no install.

import type { Backend, Channel } from "../types.js";
import { fetchText, htmlToText } from "../http.js";
import { resolveCred } from "../store.js";

const cookieBackend: Backend = {
  name: "cookie",
  available: (ctx) => !!resolveCred(ctx.config, "linkedin_cookie"),
  run: async (input, ctx) => {
    const cookie = resolveCred(ctx.config, "linkedin_cookie");
    if (!cookie) return { ok: false, error: { code: "no_cookie", message: "sem linkedin_cookie" } };
    const r = await fetchText(input, {
      timeoutMs: ctx.timeoutMs,
      headers: { cookie, "user-agent": "Mozilla/5.0 (compatible; typer-reach/1.0)" },
    });
    if (r.status >= 400) return { ok: false, error: { code: "linkedin_failed", message: `status ${r.status}` } };
    const text = htmlToText(r.text);
    return text.length > 120
      ? { ok: true, content: text.slice(0, 100_000) }
      : { ok: false, error: { code: "blocked", message: "LinkedIn exige sessão válida (cookie li_at) ou MCP" } };
  },
};

export const linkedinChannel: Channel = {
  name: "linkedin",
  description: "Ler posts/perfis do LinkedIn (precisa cookie)",
  tier: "login",
  backends: [cookieBackend],
  matches: (input) => /linkedin\.com/i.test(input),
};
