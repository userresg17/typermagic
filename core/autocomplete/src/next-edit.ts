// core/autocomplete/next-edit.ts
// Predição de próxima edição (AUTOCOMPLETE.md Estágio 6) — o "tab pra pular". A
// QUALIDADE do Cursor exige um modelo fine-tunado em sequências de edição (a
// parede); aqui entregamos o BASELINE por prompt (usa os modelos atuais + o rastro
// de edição → edição estruturada), "melhor que aleatório". O modelo fine-tunado
// (produzido por @typer/finetune) encaixa no MESMO contrato depois.

import type { Provider } from "@typer/router";

export interface NextEditRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}
export interface NextEdit {
  range: NextEditRange;
  text: string; // conteúdo que substitui o range
  confidence: number; // 0..1
}

export interface NextEditInput {
  file: string;
  recentEdits: Array<{ file: string; before: string; after: string }>;
  code: string;
  cursorLine: number; // base 0
}

const SYSTEM =
  "Você prevê a PRÓXIMA edição que o programador provavelmente fará, dado o rastro " +
  "de edições recentes e o código atual. Responda APENAS um JSON: " +
  '{"range":{"startLine":n,"startCol":n,"endLine":n,"endCol":n},"text":"...","confidence":0..1}. ' +
  "Linhas e colunas base 0. Se não houver edição óbvia, use confidence 0.";

/** Monta o prompt do preditor. Puro. */
export function buildNextEditPrompt(input: NextEditInput): string {
  const trail = input.recentEdits
    .slice(-8)
    .map((e) => `- ${e.file}: ${e.before ? e.before + " → " : "+ "}${e.after}`)
    .join("\n");
  return (
    `# Edições recentes (mais nova por último)\n${trail || "(nenhuma)"}\n\n` +
    `# Código atual (cursor na linha ${input.cursorLine})\n${input.code.slice(0, 6000)}\n\n` +
    `# Tarefa\nPreveja a próxima edição como JSON.`
  );
}

/** Extrai e valida o NextEdit do texto do modelo (primeiro objeto JSON). Puro. */
export function parseNextEdit(raw: string): NextEdit | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as {
      range?: Partial<NextEditRange>;
      text?: unknown;
      confidence?: unknown;
    };
    if (!o.range || typeof o.text !== "string") return null;
    const r = o.range;
    const n = (v: unknown): number => (typeof v === "number" && v >= 0 ? Math.floor(v) : 0);
    return {
      range: {
        startLine: n(r.startLine),
        startCol: n(r.startCol),
        endLine: n(r.endLine),
        endCol: n(r.endCol),
      },
      text: o.text,
      confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0,
    };
  } catch {
    return null;
  }
}

/** Prevê a próxima edição via o provider (baseline por prompt). null se nada. */
export async function predictNextEdit(
  provider: Provider,
  model: string,
  input: NextEditInput,
): Promise<NextEdit | null> {
  let out = "";
  for await (const c of provider.chat({
    messages: [{ role: "user", content: buildNextEditPrompt(input) }],
    system: SYSTEM,
    model,
  })) {
    out += c.text;
  }
  const edit = parseNextEdit(out);
  return edit && edit.confidence > 0 ? edit : null;
}
