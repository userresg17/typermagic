// core/meetings/summarize.ts — o modelo lê a transcrição e devolve, em pt-BR, um JSON com
// título, participantes, idioma, resumo, decisões, pendências (com responsável) e próximos
// passos. Se o original não está em português, a transcrição inteira é traduzida em blocos.
// O caller de LLM é injetado (testável com um fake).

import type { Llm, RawMeeting, Summary } from "./types.js";
import { chunkText } from "./text.js";

export const SUMMARY_SYSTEM = [
  "Você é a secretária de reuniões de uma empresa brasileira. Recebe a transcrição/anotações de UMA reunião e devolve um JSON (e nada mais) com as chaves:",
  '  "titulo": string curto (até 80 chars) que identifica a reunião;',
  '  "participantes": lista de nomes de quem participou (só nomes, sem cargos; vazio se não dá para saber);',
  '  "idioma": código do idioma predominante do texto original (pt, en, es, ...);',
  '  "resumo": 3 a 8 frases em português do Brasil com o que foi discutido e concluído;',
  '  "decisoes": lista de decisões tomadas (frases curtas, objetivas, em pt-BR);',
  '  "pendencias": lista de objetos {"oQue": string, "responsavel": string, "prazo": string|null} — toda ação que ficou para alguém; responsavel = nome da pessoa (ou "indefinido");',
  '  "proximosPassos": lista de próximos passos combinados que não são de uma pessoa específica.',
  "Regras: tudo em português do Brasil (traduza o que estiver em outra língua); não invente nada que não esteja no texto; nomes de pessoas e produtos ficam como estão; não use markdown dentro das strings; responda SOMENTE o JSON.",
].join("\n");

export const TRANSLATE_SYSTEM =
  "Traduza o texto a seguir para português do Brasil, fiel e completo, mantendo a estrutura (falantes, parágrafos, listas). Não resuma, não comente, não adicione nada. Nomes próprios ficam como estão. Responda só com a tradução.";

/** Extrai o primeiro objeto JSON de uma resposta (tolera ```json ... ``` e texto em volta). */
export function extractJson(raw: string): unknown {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("resposta do modelo sem JSON");
  return JSON.parse(body.slice(start, end + 1));
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

/** Normaliza o JSON do modelo num Summary sempre completo (campos faltando viram vazios). */
export function toSummary(obj: unknown, fallbackTitle: string): Summary {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const pend = Array.isArray(o.pendencias)
    ? o.pendencias
        .map((p) => {
          if (typeof p === "string") return { oQue: p.trim(), responsavel: "indefinido" };
          const q = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
          const prazo = str(q.prazo);
          return { oQue: str(q.oQue) || str(q.o_que) || str(q.tarefa), responsavel: str(q.responsavel) || "indefinido", ...(prazo && prazo !== "null" ? { prazo } : {}) };
        })
        .filter((p) => p.oQue)
    : [];
  return {
    titulo: str(o.titulo) || fallbackTitle,
    participantes: strList(o.participantes),
    idioma: (str(o.idioma) || "pt").toLowerCase().slice(0, 5),
    resumo: str(o.resumo),
    decisoes: strList(o.decisoes),
    pendencias: pend,
    proximosPassos: strList(o.proximosPassos ?? o.proximos_passos),
  };
}

export interface SummarizeOptions {
  /** traduzir a transcrição inteira quando não for pt (default true) */
  translateFull?: boolean;
  /** acima disto a tradução integral é pulada (só o resumo sai em pt). default 80k chars */
  translateMaxChars?: number;
  /** tamanho do bloco de tradução (default 6000) */
  chunkChars?: number;
  /** a transcrição é cortada aqui antes de ir pro modelo (default 400k chars ~ 100k tokens) */
  maxInputChars?: number;
}

export interface SummarizeResult {
  summary: Summary;
  textPt?: string;
  /** chamadas de modelo feitas */
  calls: number;
}

/** Resume (e traduz, se preciso) uma reunião crua. Lança se o modelo não devolver JSON válido
 *  em 2 tentativas — o caller decide (a ingestão NÃO grava reunião sem resumo). */
export async function summarizeMeeting(raw: RawMeeting, llm: Llm, opts: SummarizeOptions = {}): Promise<SummarizeResult> {
  const maxIn = opts.maxInputChars ?? 400_000;
  const text = raw.text.length > maxIn ? raw.text.slice(0, maxIn) + "\n[… transcrição cortada por tamanho …]" : raw.text;
  const header = [
    `Plataforma: ${raw.platform}`,
    `Data: ${raw.date}`,
    raw.title ? `Título informado: ${raw.title}` : "",
    raw.participants?.length ? `Participantes informados: ${raw.participants.join(", ")}` : "",
    raw.origin ? `Origem: ${raw.origin}` : "",
    "",
    "TEXTO DA REUNIÃO:",
    text,
  ]
    .filter((l) => l !== "")
    .join("\n");
  let calls = 0;
  let summary: Summary | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !summary; attempt++) {
    calls++;
    const out = await llm(SUMMARY_SYSTEM, attempt === 0 ? header : `${header}\n\n(Sua resposta anterior não era JSON válido: ${lastErr}. Responda SOMENTE o JSON.)`);
    try {
      summary = toSummary(extractJson(out), raw.title ?? `Reunião ${raw.date.slice(0, 10)}`);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!summary) throw new Error(`o modelo não devolveu um resumo válido (${lastErr})`);
  if (raw.title && !summary.titulo) summary.titulo = raw.title;
  // participantes informados pela fonte entram sempre (sem duplicar)
  for (const p of raw.participants ?? []) if (!summary.participantes.some((x) => x.toLowerCase() === p.toLowerCase())) summary.participantes.push(p);

  let textPt: string | undefined;
  const wantTranslate = (opts.translateFull ?? true) && summary.idioma !== "pt" && text.length <= (opts.translateMaxChars ?? 80_000);
  if (wantTranslate) {
    const parts: string[] = [];
    for (const chunk of chunkText(text, opts.chunkChars ?? 6000)) {
      calls++;
      parts.push((await llm(TRANSLATE_SYSTEM, chunk)).trim());
    }
    textPt = parts.join("\n\n");
  }
  return { summary, ...(textPt ? { textPt } : {}), calls };
}
