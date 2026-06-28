// core/edit/types.ts
// Tipos da edição com diff. Um Edit é um bloco SEARCH/REPLACE ancorado no
// conteúdo exato, não em número de linha — robusto para aplicar (diff-first).

export interface Edit {
  /** caminho relativo à raiz */
  file: string;
  /** trecho exato e existente; vazio => criação de arquivo novo */
  search: string;
  /** trecho substituto */
  replace: string;
}

/** O resultado de planejar as edições de um arquivo, em memória, sem escrever. */
export interface FilePlan {
  file: string;
  before: string;
  after: string;
  status: "modify" | "create" | "error";
  error?: string;
  /** quantos blocos foram aplicados neste arquivo */
  edits: number;
}
