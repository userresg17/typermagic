// core/meetings/types.ts — contratos da Central de Reuniões.
// Uma reunião entra como RawMeeting (texto que JÁ existe em algum lugar), é resumida e
// vira Meeting (arquivo .md na pasta única + entrada no índice).

/** de onde veio o texto */
export type Platform = "discord" | "meet" | "whatsapp" | "arquivo";

export interface RawMeeting {
  /** chave de deduplicação estável por fonte: "discord:<id da 1ª msg>", "meet:<fileId>", "whatsapp:<sha>" */
  sourceKey: string;
  platform: Platform;
  /** quando a reunião aconteceu (ISO). Fallback: quando o texto foi publicado. */
  date: string;
  title?: string;
  participants?: string[];
  /** texto completo (transcrição/anotações/resumo), como chegou */
  text: string;
  /** descrição legível da origem: "canal #transcrições (colado por Max)", "Drive: Notas do Gemini" */
  origin?: string;
}

export interface Pendencia {
  oQue: string;
  responsavel: string;
  prazo?: string;
}

/** O que o modelo extrai de cada reunião. Sempre em pt-BR. */
export interface Summary {
  titulo: string;
  participantes: string[];
  /** idioma predominante do texto original (código: pt, en, es…) */
  idioma: string;
  resumo: string;
  decisoes: string[];
  pendencias: Pendencia[];
  proximosPassos: string[];
}

export interface Meeting extends RawMeeting {
  /** id = nome do arquivo sem .md (AAAA-MM-DD_HHMM_plataforma_slug) */
  id: string;
  /** caminho absoluto do .md */
  file: string;
  summary: Summary;
  /** tradução integral p/ pt-BR quando o original estava em outra língua */
  textPt?: string;
  ingestedAt: string;
}

/** Caller de LLM injetado (provider do typer, Anthropic etc.). system + user → texto. */
export type Llm = (system: string, user: string) => Promise<string>;
