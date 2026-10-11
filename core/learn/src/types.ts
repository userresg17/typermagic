// core/learn/types.ts
// Tipos do aprendizado por tutorial. O fluxo é linear e cada etapa deixa artefato em
// disco (<workDir>/<videoId>/…) para ser inspecionável e retomável: download →
// transcrição → cenas/frames → descrição por visão → destilação → skill candidata.

/** Metadados do vídeo-fonte (do info.json do yt-dlp). Só o que o plano usa. */
export interface VideoMeta {
  id: string;
  url: string;
  title: string;
  channel?: string | undefined;
  /** segundos */
  duration: number;
  uploadDate?: string | undefined;
  /** licença declarada pela plataforma (ex.: "Creative Commons Attribution license (reuse allowed)") */
  license?: string | undefined;
  /** idioma das legendas obtidas */
  subtitleLang?: string;
}

export interface Downloaded {
  meta: VideoMeta;
  dir: string;
  videoPath: string;
  /** VTT (manual > automática); ausente quando o vídeo não tem legenda */
  subtitlePath?: string;
  infoPath: string;
}

/** Um trecho de fala com tempo. `coarse` = veio do fallback por blocos (Whisper), tempo aproximado. */
export interface Segment {
  start: number;
  end: number;
  text: string;
  coarse?: boolean;
}

export interface Frame {
  /** índice sequencial */
  i: number;
  /** instante no vídeo (s) */
  t: number;
  path: string;
  /** motivo da captura: corte de cena ou amostragem periódica */
  reason: "scene" | "periodic";
}

/** O que o modelo de visão viu num frame, ancorado na fala do intervalo. */
export interface FrameDescription {
  t: number;
  /** programa visível (nome como aparece na tela) ou "desconhecido" */
  app: string;
  /** painel/aba/página em foco (ex.: "Edit page", "Color page", "Export dialog") */
  panel: string;
  /** ação que o instrutor está executando ou acabou de executar, em uma frase */
  action: string;
  /** rótulos de UI legíveis e relevantes (menus, botões, campos) */
  uiElements: string[];
  /** atalho de teclado mostrado/dito, se houver */
  shortcut?: string;
  /** observações: valores digitados, parâmetros, avisos */
  notes?: string;
}

export type ProgressFn = (message: string) => void | Promise<void>;

export interface LearnOptions {
  /** raiz de trabalho (padrão ~/.typer/learn) */
  workDir: string;
  /** onde a skill candidata é gravada: <skillsDir>/<id>/SKILL.md */
  skillsDir: string;
  /** modelo de visão p/ descrever frames (barato) e modelo p/ destilar (forte) */
  visionModel: string;
  distillModel: string;
  /** teto de frames enviados ao modelo de visão */
  maxFrames?: number;
  /** frames por chamada ao modelo de visão */
  batchSize?: number;
  /** nome do programa, se o usuário informou (ajuda a destilação) */
  appHint?: string | undefined;
  onProgress?: ProgressFn;
  signal?: AbortSignal | undefined;
  /** reaproveita artefatos existentes no disco (padrão true) */
  resume?: boolean;
}

export interface LearnResult {
  skillId: string;
  skillPath: string;
  meta: VideoMeta;
  frames: number;
  segments: number;
  descriptions: number;
  /** tokens somados das chamadas ao modelo (entrada/saída), p/ registrar custo */
  usage: { inputTokens: number; outputTokens: number };
  /** duração de cada etapa (ms) */
  timings: Record<string, number>;
}
