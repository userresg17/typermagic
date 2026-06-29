// core/reach/types.ts
// "Olhos na internet" — contratos do reach. Cada CANAL (web, youtube, github, rss,
// twitter, reddit, ...) tem uma lista ordenada de BACKENDS (cadeia de fallback): o
// roteador tenta cada um até um responder. É a tecnologia do agent-reach, nativa.

export type ChannelTier = "zero-config" | "login" | "mcp";

/** Credenciais/preferências resolvidas do store (~/.typer/reach/config.json). */
export interface ReachConfig {
  [key: string]: unknown;
}

/** Contexto passado a cada backend: config + (opcional) execução de binário externo. */
export interface ReachContext {
  config: ReachConfig;
  /** roda um binário com argv (sem shell). Só backends que dependem de CLI (yt-dlp, gh). */
  runArgv?: (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** timeout de rede por requisição (ms). */
  timeoutMs?: number;
}

/** Resultado de uma leitura/busca. `content` é markdown/texto pronto p/ o agente. */
export interface ReachResult {
  ok: boolean;
  content?: string;
  meta?: Record<string, unknown>;
  /** qual backend respondeu (preenchido pelo roteador). */
  backend?: string;
  error?: { code: string; message: string };
}

export type ProbeStatusKind = "ok" | "needs-config" | "unavailable";

export interface ProbeStatus {
  status: ProbeStatusKind;
  message: string;
  activeBackend?: string;
}

/** Um backend de um canal (ex.: jina | raw para web; api | gh para github). */
export interface Backend {
  name: string;
  /** disponível neste ambiente? (binário instalado, key presente, etc.). */
  available(ctx: ReachContext): boolean | Promise<boolean>;
  /** o doctor pode confiar em `available()` como prova de prontidão? Default true.
   *  false = backend best-effort: pode falhar em runtime apesar de "disponível", então
   *  o doctor NÃO o conta como pronto (ex.: scrape nativo do YouTube, hoje barrado por
   *  PoToken — serve só como 1ª tentativa barata antes do fallback de verdade). */
  probeReliable?: boolean;
  /** executa a ação sobre o input (url/id/query). Nunca lança: devolve ReachResult. */
  run(input: string, ctx: ReachContext): Promise<ReachResult>;
}

/** Um canal = uma plataforma, com cadeia de backends e casamento de URL. */
export interface Channel {
  name: string;
  description: string;
  tier: ChannelTier;
  /** backends em ordem de preferência (1º que funcionar vence). */
  backends: Backend[];
  /** esta URL pertence a este canal? (usado por routeUrl). */
  matches(input: string): boolean;
}

/** Feature → chaves de config exigidas (espelha o config.py do agent-reach). */
export const FEATURE_REQUIREMENTS: Record<string, string[]> = {
  youtube: ["yt-dlp"], // o scrape nativo morreu (PoToken); a transcrição depende do yt-dlp
  search: ["exa_api_key"],
  github: ["github_token"], // opcional: público funciona sem
  twitter: ["twitter_cookie"],
  reddit: ["reddit_cookie"],
  linkedin: ["linkedin_cookie"],
  xueqiu: ["xueqiu_cookie"],
  xiaohongshu: ["xiaohongshu_cookie"],
  whisper: ["groq_api_key"], // ou openai_api_key
};
