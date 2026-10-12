// core/agent/tools/meetings.ts → família "reuniões": a Central de Reuniões vista pelo agente.
// Três ferramentas só-leitura (permission "read", in_process — passam no grant READONLY, então
// Telegram e Jarvis usam igual): buscar, listar e ler. A central em si (ingestão, resumo,
// índice) vive em @typer/meetings e é injetada por ctx.deps.meetings (tipado solto p/ não
// acoplar os pacotes, como o vault).

import type { Tool } from "./types.js";

export interface MeetingsDep {
  dir: string;
  search(query: string, opts?: { k?: number; platform?: "discord" | "meet" | "whatsapp" | "arquivo"; since?: string; until?: string }): Promise<
    Array<{ meeting: MeetingLike; score: number; snippet: string }>
  >;
  read(id: string): Promise<MeetingLike | null>;
  list(): Promise<MeetingLike[]>;
}
export interface MeetingLike {
  id: string;
  file: string;
  date: string;
  platform: string;
  text: string;
  textPt?: string;
  summary: {
    titulo: string;
    participantes: string[];
    idioma: string;
    resumo: string;
    decisoes: string[];
    pendencias: Array<{ oQue: string; responsavel: string; prazo?: string }>;
    proximosPassos: string[];
  };
}

export const MEETINGS_SKILL = [
  "## Central de Reuniões (reunioes_*)",
  "Você tem acesso às reuniões da empresa (transcrições do Discord, anotações do Google Meet/Gemini e resumos do WhatsApp) já resumidas em pt-BR.",
  "Para QUALQUER pergunta sobre reuniões, decisões, pendências, o que foi combinado com alguém/algum time, ou para montar um resumo consolidado:",
  "1. chame reunioes_buscar com palavras-chave (time, pessoa, assunto; pode filtrar por plataforma e data);",
  "2. chame reunioes_ler nas mais relevantes para ter o texto completo quando a pergunta exige detalhe;",
  "3. responda citando a data e o título de cada reunião usada. Não invente decisões que não estejam nos textos.",
  "Mapeie: 'time de dev' ≈ reuniões do Discord; 'sócios' ≈ WhatsApp/Meet com os sócios; na dúvida, busque em todas.",
].join("\n");

export function meetingsSkillSection(tools: { name: string }[]): string {
  return tools.some((t) => t.name === "reunioes_buscar") ? MEETINGS_SKILL : "";
}

const brief = (m: MeetingLike): Record<string, unknown> => ({
  id: m.id,
  data: m.date.slice(0, 16),
  plataforma: m.platform,
  titulo: m.summary.titulo,
  participantes: m.summary.participantes,
  resumo: m.summary.resumo,
  decisoes: m.summary.decisoes,
  pendencias: m.summary.pendencias,
});

const platformOf = (v: unknown): "discord" | "meet" | "whatsapp" | "arquivo" | undefined =>
  v === "discord" || v === "meet" || v === "whatsapp" || v === "arquivo" ? v : undefined;

const buscar: Tool = {
  name: "reunioes_buscar",
  family: "reuniões",
  description:
    "Busca na Central de Reuniões (Discord/time de dev, Google Meet, WhatsApp/sócios) por palavras-chave: assunto, pessoa, time, decisão. Devolve as reuniões mais relevantes com resumo, decisões e pendências. Use antes de responder qualquer pergunta sobre reuniões ou o que foi combinado.",
  params: [
    { name: "consulta", type: "string", required: true, description: "palavras-chave (ex.: 'time de dev API pagamentos', 'sócios filial')" },
    { name: "plataforma", type: "string", required: false, description: "discord | meet | whatsapp | arquivo (vazio = todas)" },
    { name: "desde", type: "string", required: false, description: "data inicial AAAA-MM-DD" },
    { name: "ate", type: "string", required: false, description: "data final AAAA-MM-DD" },
    { name: "k", type: "number", required: false, description: "quantas devolver (default 5, máx 20)" },
  ],
  returns: "lista de reuniões {id, data, plataforma, titulo, participantes, resumo, decisoes, pendencias, trecho}",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const hub = ctx.deps?.meetings;
    if (!hub) return { ok: false, error: { code: "meetings_unavailable", message: "Central de Reuniões desligada neste gateway" } };
    const consulta = String(args.consulta ?? "").trim();
    const k = Math.min(20, Math.max(1, Number(args.k) || 5));
    const platform = platformOf(args.plataforma);
    const hits = await hub.search(consulta, {
      k,
      ...(platform ? { platform } : {}),
      ...(typeof args.desde === "string" && args.desde ? { since: args.desde } : {}),
      ...(typeof args.ate === "string" && args.ate ? { until: args.ate } : {}),
    });
    return { ok: true, value: { total: hits.length, reunioes: hits.map((h) => ({ ...brief(h.meeting), trecho: h.snippet })) } };
  },
};

const listar: Tool = {
  name: "reunioes_listar",
  family: "reuniões",
  description: "Lista as reuniões mais recentes da Central (título, data, plataforma, participantes). Útil para 'quais foram as últimas reuniões' ou para achar o id antes de reunioes_ler.",
  params: [
    { name: "n", type: "number", required: false, description: "quantas (default 10, máx 50)" },
    { name: "plataforma", type: "string", required: false, description: "discord | meet | whatsapp | arquivo (vazio = todas)" },
  ],
  returns: "lista de reuniões resumidas, mais recente primeiro",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const hub = ctx.deps?.meetings;
    if (!hub) return { ok: false, error: { code: "meetings_unavailable", message: "Central de Reuniões desligada neste gateway" } };
    const n = Math.min(50, Math.max(1, Number(args.n) || 10));
    const platform = platformOf(args.plataforma);
    const all = (await hub.list()).filter((m) => !platform || m.platform === platform).slice(0, n);
    return { ok: true, value: { total: all.length, pasta: hub.dir, reunioes: all.map(brief) } };
  },
};

const MAX_TEXT = 30_000;

const ler: Tool = {
  name: "reunioes_ler",
  family: "reuniões",
  description: "Lê UMA reunião da Central pelo id (de reunioes_buscar/listar): resumo completo, decisões, pendências e, se pedido, a transcrição inteira (em pt-BR quando houver tradução).",
  params: [
    { name: "id", type: "string", required: true, description: "id da reunião" },
    { name: "parte", type: "string", required: false, description: "'resumo' (default) ou 'completa' (inclui a transcrição, até 30k chars)" },
  ],
  returns: "a reunião",
  permission: "read",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const hub = ctx.deps?.meetings;
    if (!hub) return { ok: false, error: { code: "meetings_unavailable", message: "Central de Reuniões desligada neste gateway" } };
    const id = String(args.id ?? "").trim();
    const m = id ? await hub.read(id) : null;
    if (!m) return { ok: false, error: { code: "not_found", message: `reunião não encontrada: ${id || "(sem id)"}` } };
    const full = args.parte === "completa";
    const body = m.textPt ?? m.text;
    return {
      ok: true,
      value: {
        ...brief(m),
        proximosPassos: m.summary.proximosPassos,
        idioma: m.summary.idioma,
        arquivo: m.file,
        ...(full ? { transcricao: body.length > MAX_TEXT ? body.slice(0, MAX_TEXT) + "\n[… cortado; leia o arquivo para o resto …]" : body } : {}),
      },
    };
  },
};

export const meetingsTools: Tool[] = [buscar, listar, ler];
