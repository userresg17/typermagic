// core/autocomplete/index.ts — superfície pública do @typer/autocomplete.

export {
  buildNextEditPrompt,
  parseNextEdit,
  predictNextEdit,
} from "./next-edit.js";
export type { NextEdit, NextEditRange, NextEditInput } from "./next-edit.js";
