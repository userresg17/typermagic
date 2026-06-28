// core/edit/index.ts — superfície pública do pacote @typer/edit

export type { Edit, FilePlan } from "./types.js";
export { parseEdits, EditParseError } from "./parse.js";
export { planEdits, writePlan } from "./apply.js";
export { renderDiff, renderPlanDiff } from "./diff.js";
export { EDIT_SYSTEM_INSTRUCTION } from "./format.js";
