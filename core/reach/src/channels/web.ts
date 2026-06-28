// core/reach/channels/web.ts
// Canal web (catch-all): lê qualquer página → markdown/texto. Backends:
//   1) jina  — r.jina.ai (já devolve markdown limpo, ótimo p/ páginas pesadas de JS)
//   2) raw   — fetch direto + HTML→texto (sem dep externa)

import type { Backend, Channel } from "../types.js";
import { fetchText, htmlToText } from "../http.js";

const MAX = 200_000;

const jina: Backend = {
  name: "jina",
  available: () => true,
  run: async (url, ctx) => {
    const r = await fetchText(`https://r.jina.ai/${url}`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "x-return-format": "markdown" },
    });
    if (r.status >= 400 || !r.text.trim()) {
      return { ok: false, error: { code: "jina_failed", message: `status ${r.status}` } };
    }
    return { ok: true, content: r.text.slice(0, MAX), meta: { url } };
  },
};

const raw: Backend = {
  name: "raw",
  available: () => true,
  run: async (url, ctx) => {
    const r = await fetchText(url, {
      timeoutMs: ctx.timeoutMs,
      headers: { "user-agent": "Mozilla/5.0 (compatible; typer-reach/1.0)" },
    });
    if (r.status >= 400) {
      return { ok: false, error: { code: "fetch_failed", message: `status ${r.status}` } };
    }
    const ct = r.headers.get("content-type") ?? "";
    const body = /html/i.test(ct) || /^\s*</.test(r.text) ? htmlToText(r.text) : r.text;
    if (!body.trim()) return { ok: false, error: { code: "empty", message: "página vazia" } };
    return { ok: true, content: body.slice(0, MAX), meta: { url } };
  },
};

export const webChannel: Channel = {
  name: "web",
  description: "Ler qualquer página (→ markdown/texto)",
  tier: "zero-config",
  backends: [jina, raw],
  matches: (input) => /^https?:\/\//i.test(input),
};
