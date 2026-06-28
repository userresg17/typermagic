// core/index/symbols.ts
// Extrai definições e referências de um arquivo via tree-sitter. Alimenta o
// grafo de símbolos (quem chama/usa quem). Provider-agnóstico de modelo; usa só
// a árvore sintática. Retorna null sem gramática (o chamador ignora o arquivo).

import { parserFor } from "./languages.js";

export interface SymbolDef {
  name: string;
  file: string;
  line: number; // 1-based
  kind: string; // tipo do nó tree-sitter
}

export interface FileSymbols {
  defs: SymbolDef[];
  refs: string[]; // nomes referenciados (identificadores), deduplicados
}

// Tipos de nó que contam como definição de símbolo, em JS/TS e Python.
const DEF_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "function_definition", // python
  "class_definition", // python
]);

const MAX_REFS = 300;

export async function extractSymbols(
  content: string,
  file: string,
): Promise<FileSymbols | null> {
  const parser = await parserFor(file);
  if (!parser) return null;
  const tree = parser.parse(content);
  const root = tree.rootNode;

  const defs: SymbolDef[] = [];
  for (const node of root.descendantsOfType([...DEF_TYPES])) {
    const nameNode =
      node.childForFieldName("name") ??
      node.namedChildren.find((c) => c.type.endsWith("identifier"));
    const name = nameNode?.text;
    if (name) {
      defs.push({ name, file, line: node.startPosition.row + 1, kind: node.type });
    }
  }

  const defNames = new Set(defs.map((d) => d.name));
  const refs = new Set<string>();
  for (const id of root.descendantsOfType([
    "identifier",
    "type_identifier",
    "property_identifier", // chamadas de método: xs.reduce(...)
  ])) {
    const t = id.text;
    if (t && !defNames.has(t)) {
      refs.add(t);
      if (refs.size >= MAX_REFS) break;
    }
  }

  return { defs, refs: [...refs] };
}
