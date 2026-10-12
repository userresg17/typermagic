// core/meetings/index.ts — superfície pública do pacote @typer/meetings
export type { Platform, RawMeeting, Pendencia, Summary, Meeting, Llm } from "./types.js";
export { normalize, slugify, tokenize, isMeetingForward, titleFromText, localIso, datePrefix, chunkText, shortHash } from "./text.js";
export { MeetingStore, renderMeeting, parseMeeting, renderIndex, withLock, INDEX_FILE, PLATFORM_LABEL } from "./store.js";
export type { SearchHit, SearchOptions } from "./store.js";
export { summarizeMeeting, extractJson, toSummary, SUMMARY_SYSTEM, TRANSLATE_SYSTEM } from "./summarize.js";
export type { SummarizeOptions, SummarizeResult } from "./summarize.js";
export { DiscordClient, groupBatches, isSettled, batchToRaw, isTextAttachment } from "./discord.js";
export type { DiscordMessage, DiscordAttachment, DiscordChannel, DiscordGuild, Batch } from "./discord.js";
export { GoogleAuth, DriveClient, loadClientFile, loginInteractive, cleanGeminiTitle, driveFileToRaw, DRIVE_SCOPE } from "./google.js";
export type { DriveFile } from "./google.js";
export { MeetingsHub, formatSummaryMessage } from "./hub.js";
export type { HubOptions, HubState, IngestResult, DiscordSourceConfig, DriveSourceConfig } from "./hub.js";
