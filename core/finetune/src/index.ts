// core/finetune/index.ts — superfície pública do @typer/finetune.

export { parseTrail, collectFromRoot, collectFromGit, parseGitLog } from "./collect.js";
export type { EditEntry } from "./collect.js";
export {
  buildSamples,
  splitDataset,
  toOpenAiJsonl,
  toGenericJsonl,
  FINETUNE_SYSTEM,
} from "./dataset.js";
export type { Sample, Dataset } from "./dataset.js";
export { buildModelfile } from "./ollama.js";
export { runFineTune } from "./agent.js";
export type { FineTuneBackend, FineTuneReport } from "./agent.js";
