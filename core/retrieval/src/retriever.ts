// core/retrieval/retriever.ts
// O retriever do Estágio 1: junta o arquivo aberto e o grep ripgrep num
// Context sob orçamento. Implementa a interface Retriever da arquitetura, que a
// Fase 3 reescreve com busca semântica sem trocar quem chama.

import type { Context, Retriever, TokenBudget } from "./types.js";
import { readContextFile } from "./file-context.js";
import { grep } from "./ripgrep.js";
import { extractTerms } from "./terms.js";
import { assembleContext } from "./assemble.js";

export interface RipgrepRetrieverOptions {
  /** raiz do repositório para o grep e a resolução de caminhos */
  root: string;
  /** arquivos-alvo a ler inteiros (os "arquivos abertos") */
  files?: string[];
  /** desliga o grep, deixando só os arquivos */
  grep?: boolean;
}

export class RipgrepRetriever implements Retriever {
  private readonly root: string;
  private readonly files: string[];
  private readonly useGrep: boolean;

  constructor(opts: RipgrepRetrieverOptions) {
    this.root = opts.root;
    this.files = opts.files ?? [];
    this.useGrep = opts.grep ?? true;
  }

  async retrieve(query: string, budget: TokenBudget): Promise<Context> {
    const files = await Promise.all(
      this.files.map((p) => readContextFile(this.root, p)),
    );

    const snippets = this.useGrep
      ? await grep({ root: this.root, terms: extractTerms(query) })
      : [];

    return assembleContext(query, files, snippets, budget);
  }
}
