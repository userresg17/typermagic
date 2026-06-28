// core/agent/tools/families/web.ts → web e documentação (AGENT_TOOLS.md §7). Rede
// com efeito pede aprovação. web_fetch é real (fetch nativo); busca/docs/visão
// precisam de provider externo → stub honesto; browser_action roda em microVM.

import type { Tool } from "./types.js";

const webFetch: Tool = {
  name: "web_fetch",
  family: "web",
  description: "Baixa o conteúdo (texto) de uma URL.",
  params: [{ name: "url", type: "string", required: true, description: "URL http(s)" }],
  returns: "conteúdo (texto, truncado)",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async (args) => {
    const url = args.url as string;
    if (!/^https?:\/\//.test(url)) return { ok: false, error: { code: "bad_url", message: "URL deve ser http(s)" } };
    try {
      const res = await fetch(url);
      const text = await res.text();
      return { ok: true, value: { status: res.status, body: text.slice(0, 100_000) } };
    } catch (e) {
      return { ok: false, error: { code: "fetch_failed", message: e instanceof Error ? e.message : String(e) } };
    }
  },
};

const webSearch: Tool = {
  name: "web_search",
  family: "web",
  description: "Busca na web (requer provider de busca configurado).",
  params: [{ name: "query", type: "string", required: true, description: "consulta" }],
  returns: "resultados",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async () => ({
    ok: false,
    error: { code: "no_search_provider", message: "configure um provider de busca (ex.: API key) para web_search" },
  }),
};

const docsLookup: Tool = {
  name: "docs_lookup",
  family: "web",
  description: "Consulta a doc de uma lib (requer provider de docs).",
  params: [
    { name: "lib", type: "string", required: true, description: "biblioteca" },
    { name: "query", type: "string", required: true, description: "o que procurar" },
  ],
  returns: "doc",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async () => ({
    ok: false,
    error: { code: "not_configured", message: "docs_lookup precisa de um provider de documentação" },
  }),
};

const browserAction: Tool = {
  name: "browser_action",
  family: "web",
  description: "Ação de navegador isolada (microVM).",
  params: [{ name: "action", type: "Action", required: true, description: "ação na página" }],
  returns: "estado da página",
  permission: "network",
  exec: "microvm",
  tier: "lazy",
  requiresApproval: true,
  sealGated: false,
  effect: { external: true, reversible: false, kind: "network" }, // ação na página → irreversível
  handler: async (args, ctx) => {
    const out = await ctx.deps!.microvm!.run(JSON.stringify(args.action), "browser");
    return { ok: true, value: out };
  },
};

const imageRead: Tool = {
  name: "image_read",
  family: "web",
  description: "Descreve uma imagem (requer modelo de visão).",
  params: [{ name: "path", type: "string", required: true, description: "arquivo de imagem" }],
  returns: "descrição",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async () => ({
    ok: false,
    error: { code: "needs_vision", message: "image_read precisa de um modelo de visão configurado" },
  }),
};

export const webTools: Tool[] = [webFetch, webSearch, docsLookup, browserAction, imageRead];
