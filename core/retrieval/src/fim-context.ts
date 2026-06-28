// core/retrieval/fim-context.ts
// Montagem do contexto do autocomplete (AUTOCOMPLETE.md Estágio 3). PURO e
// testável: recebe os sinais voláteis do editor + o contexto do repo e devolve um
// bloco de contexto (comentado, pra encaixar tanto no prompt instruído quanto no
// prefixo do FIM nativo do Ollama), cortando por prioridade até o orçamento.
//
// Prioridade (forte → fraco): rastro de edição (intenção) > símbolos em escopo >
// definições relacionadas > diagnósticos > abas abertas. Sem busca vetorial — o
// caminho quente do autocomplete não espera recuperação pesada.

export interface EditTrailEntry {
  file: string;
  before: string;
  after: string;
}

export interface FimDiagnostic {
  message: string;
  line: number;
  severity: string;
}

/** Sinais voláteis vindos do editor (a extensão coleta e passa). */
export interface FimSignals {
  file: string;
  editTrail?: EditTrailEntry[];
  openTabs?: string[];
  diagnostics?: FimDiagnostic[];
}

/** Contexto do repo (o server computa do grafo de símbolos). */
export interface RepoContext {
  scopeSymbols?: Array<{ name: string; kind: string }>;
  relatedDefs?: Array<{ file: string; names: string[] }>;
}

export interface FimBudget {
  /** teto aproximado de caracteres (token ≈ 4 chars) */
  maxChars: number;
}

const DEFAULT_BUDGET: FimBudget = { maxChars: 2000 };

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

/** Monta o bloco de contexto (linhas comentadas) sob o orçamento. "" se vazio. */
export function assembleFimContext(
  signals: FimSignals,
  repo: RepoContext = {},
  budget: FimBudget = DEFAULT_BUDGET,
): string {
  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    if (used + line.length + 1 > budget.maxChars) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };

  // 1. rastro de edição — o sinal mais forte de intenção
  const trail = signals.editTrail ?? [];
  if (trail.length > 0) {
    push("// Edições recentes (mais nova por último):");
    for (const e of trail.slice(-6)) {
      const change = e.before ? `${clip(e.before, 60)} → ${clip(e.after, 60)}` : `+ ${clip(e.after, 80)}`;
      if (!push(`//   ${e.file}: ${change}`)) break;
    }
  }

  // 2. símbolos em escopo (deste arquivo)
  const scope = repo.scopeSymbols ?? [];
  if (scope.length > 0) {
    push("// Símbolos neste arquivo:");
    const names = scope.map((s) => `${s.name}(${s.kind})`).join(", ");
    push(`//   ${clip(names, 400)}`);
  }

  // 3. definições relacionadas (vizinhos no grafo)
  const related = repo.relatedDefs ?? [];
  for (const r of related) {
    if (r.names.length === 0) continue;
    if (!push(`// ${r.file}: ${clip(r.names.join(", "), 200)}`)) break;
  }

  // 4. diagnósticos perto do cursor
  const diags = signals.diagnostics ?? [];
  if (diags.length > 0) {
    push("// Diagnósticos:");
    for (const d of diags.slice(0, 5)) {
      if (!push(`//   [${d.severity}] linha ${d.line}: ${clip(d.message, 100)}`)) break;
    }
  }

  // 5. abas abertas (LRU) — contexto fraco, preenche o que sobrar
  const tabs = (signals.openTabs ?? []).filter((t) => t !== signals.file);
  if (tabs.length > 0) push(`// Abas abertas: ${clip(tabs.slice(0, 10).join(", "), 200)}`);

  return lines.join("\n");
}
