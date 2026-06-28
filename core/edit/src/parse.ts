// core/edit/parse.ts
// Lê a resposta do modelo e extrai os blocos SEARCH/REPLACE. Puro e testável.
// Tolera texto solto fora dos blocos (ignora), mas exige um ### FILE: antes de
// cada bloco.

import type { Edit } from "./types.js";
import { FILE_PREFIX, RE_SEARCH, RE_SEP, RE_REPLACE } from "./format.js";

export class EditParseError extends Error {}

export function parseEdits(text: string): Edit[] {
  const lines = text.split("\n");
  const edits: Edit[] = [];
  let currentFile: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trimStart().startsWith(FILE_PREFIX)) {
      currentFile = line.slice(line.indexOf(FILE_PREFIX) + FILE_PREFIX.length).trim();
      i++;
      continue;
    }

    if (RE_SEARCH.test(line)) {
      if (!currentFile) {
        throw new EditParseError(
          `Bloco SEARCH sem um "### FILE:" antes (linha ${i + 1}).`,
        );
      }
      // coleta SEARCH até o separador
      const search: string[] = [];
      i++;
      while (i < lines.length && !RE_SEP.test(lines[i]!)) {
        search.push(lines[i]!);
        i++;
      }
      if (i >= lines.length) {
        throw new EditParseError("Bloco SEARCH sem separador =======.");
      }
      i++; // pula o separador
      // coleta REPLACE até o fim do bloco
      const replace: string[] = [];
      while (i < lines.length && !RE_REPLACE.test(lines[i]!)) {
        replace.push(lines[i]!);
        i++;
      }
      if (i >= lines.length) {
        throw new EditParseError("Bloco sem o fechamento >>>>>>> REPLACE.");
      }
      i++; // pula o fechamento

      edits.push({
        file: currentFile,
        search: search.join("\n"),
        replace: replace.join("\n"),
      });
      continue;
    }

    i++;
  }

  return edits;
}
