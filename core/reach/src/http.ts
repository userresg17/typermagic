// core/reach/http.ts
// Helpers de rede zero-dep compartilhados pelos canais: fetch com timeout, e uma
// conversão HTML→texto simples (sem dependência de parser).

const DEFAULT_TIMEOUT = 20_000;

export interface FetchResult {
  status: number;
  text: string;
  headers: Headers;
}

/** GET (ou POST) com timeout via AbortController. Nunca lança por status; lança só em rede. */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number | undefined; headers?: Record<string, string>; method?: string; body?: string } = {},
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      ...(opts.method ? { method: opts.method } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    });
    return { status: res.status, text: await res.text(), headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** HTML → texto legível (sem dep): tira script/style, vira quebras de linha, decodifica. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
