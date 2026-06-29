// core/agent/tools/reach.ts → família "reach": dá ao agente OLHOS NA INTERNET.
// Chama @typer/reach (canais com cadeia de fallback). Tudo permission "network",
// effect externo reversível (leitura) → passa pelo broker + policy gate (allowlist
// de hosts) + aprovação interativa.

import type { Tool, ToolResult } from "./types.js";
import { runArgv } from "./executors.js";
import {
  loadConfig,
  reachRead,
  reachSearch,
  reachChannel,
  checkAll,
  formatReport,
  REACH_SKILL,
  type ReachContext,
  type ReachResult,
} from "@typer/reach";

async function reachCtx(): Promise<ReachContext> {
  return {
    config: await loadConfig(),
    runArgv: async (file, args) => {
      const r = await runArgv(file, args, { timeoutMs: 60_000 });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr };
    },
    timeoutMs: 25_000,
  };
}

function wrap(r: ReachResult): ToolResult {
  return r.ok
    ? { ok: true, value: { content: r.content, backend: r.backend, ...(r.meta ? { meta: r.meta } : {}) } }
    : { ok: false, error: { code: r.error?.code ?? "reach_failed", message: r.error?.message ?? "falhou" } };
}

const isHttp = (s: string) => /^https?:\/\//i.test(s);

const reachReadTool: Tool = {
  name: "reach_read",
  family: "reach",
  description: "Lê qualquer URL da internet e devolve markdown. Roteia o canal certo (web, GitHub, RSS, YouTube).",
  params: [{ name: "url", type: "string", required: true, description: "URL http(s)" }],
  returns: "conteúdo em markdown + backend usado",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async (args) => {
    const url = args.url as string;
    if (!isHttp(url)) return { ok: false, error: { code: "bad_url", message: "URL deve ser http(s)" } };
    return wrap(await reachRead(url, await reachCtx()));
  },
};

const reachSearchTool: Tool = {
  name: "reach_search",
  family: "reach",
  description: "Busca na web (Exa semântico com EXA_API_KEY, ou DuckDuckGo). Devolve lista de resultados.",
  params: [{ name: "query", type: "string", required: true, description: "consulta" }],
  returns: "resultados (título + url + trecho)",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async (args) => {
    const query = (args.query as string)?.trim();
    if (!query) return { ok: false, error: { code: "bad_query", message: "consulta vazia" } };
    return wrap(await reachSearch(query, await reachCtx()));
  },
};

const reachVideoTool: Tool = {
  name: "reach_video",
  family: "reach",
  description: "Transcrição de um vídeo do YouTube (legendas nativas; fallback yt-dlp se instalado).",
  params: [{ name: "url", type: "string", required: true, description: "URL do vídeo" }],
  returns: "transcrição (texto)",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async (args) => {
    const url = args.url as string;
    if (!isHttp(url)) return { ok: false, error: { code: "bad_url", message: "URL deve ser http(s)" } };
    return wrap(await reachChannel("youtube", url, await reachCtx()));
  },
};

const reachSocialTool: Tool = {
  name: "reach_social",
  family: "reach",
  description: "Lê um post/thread de rede social (Twitter/X, Reddit, LinkedIn) ou faz fallback p/ leitura web.",
  params: [{ name: "url", type: "string", required: true, description: "URL do post/thread" }],
  returns: "conteúdo do post + metadados",
  permission: "network",
  exec: "subprocess",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  effect: { external: true, reversible: true, kind: "network" },
  handler: async (args) => {
    const url = args.url as string;
    if (!isHttp(url)) return { ok: false, error: { code: "bad_url", message: "URL deve ser http(s)" } };
    // reachRead roteia pelo registry: URLs de Twitter/X, Reddit e LinkedIn casam seus
    // canais nativos (com cadeia de fallback p/ leitura web pública se faltar cookie).
    return wrap(await reachRead(url, await reachCtx()));
  },
};

const reachStatusTool: Tool = {
  name: "reach_status",
  family: "reach",
  description: "Diagnóstico (doctor): quais canais de internet estão prontos e qual backend cada um usa.",
  params: [],
  returns: "relatório de status por canal",
  permission: "network",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async () => {
    const reports = await checkAll(await reachCtx());
    return { ok: true, value: { report: formatReport(reports), channels: reports } };
  },
};

export const reachTools: Tool[] = [reachReadTool, reachSearchTool, reachVideoTool, reachSocialTool, reachStatusTool];

/** Doc de capacidade do reach p/ o system prompt — SÓ quando alguma tool reach_* está
 *  exposta ao modelo. Ensina a metodologia (qual canal p/ qual alvo, cadeia de fallback)
 *  e evita o "não tenho acesso à internet". Vazio quando o reach não está disponível. */
export function reachSkillSection(tools: { name: string }[]): string {
  return tools.some((t) => t.name.startsWith("reach_")) ? REACH_SKILL : "";
}
