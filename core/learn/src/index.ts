// core/learn/index.ts — superfície pública do pacote @typer/learn
// Aprendizado por tutorial (Fase 7 do plano macOS): vídeo → skill GUI candidata.

export type { VideoMeta, Downloaded, Segment, Frame, FrameDescription, LearnOptions, LearnResult, ProgressFn } from "./types.js";
export { download, videoIdOf, metaFromInfo } from "./download.js";
export { parseVttCues, dedupeRolling, transcriptFromVtt, transcriptFromAudio, speechBetween, transcriptText, coverage, parseTimestamp, fmt } from "./transcript.js";
export { detectScenes, planTimestamps, extractFrames, existingFrames, dHashFromGray, hamming } from "./scenes.js";
export { describeFrames, extractJsonArray } from "./describe.js";
export { distill, toSkill, coerceDistilled, renderMethodology, slugify, extractJsonObject } from "./distill.js";
export type { Distilled, DistillInput } from "./distill.js";
export { learn, listSkills, readSkill, summarizeSkill } from "./pipeline.js";
export type { LearnDeps } from "./pipeline.js";
export { setupLearn, resolveModels, defaultWorkDir } from "./setup.js";
export type { LearnSetup } from "./setup.js";
