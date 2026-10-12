// core/meetings/discord.ts — lê um canal de texto do Discord por REST (sem websocket, sem
// gateway): GET /channels/{id}/messages?after=<último id>. Bot só com permissão de leitura.
// O Max cola a transcrição em uma ou várias mensagens seguidas (limite de 2000 chars por
// mensagem) ou anexa um .txt — então mensagens do MESMO autor com intervalo curto entre si
// viram UM lote, e o lote só é ingerido depois de "assentar" (última msg há > settleMs),
// para não cortar uma colagem no meio.

import type { RawMeeting } from "./types.js";
import { normalize, titleFromText } from "./text.js";

const API = "https://discord.com/api/v10";

export interface DiscordAuthor {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}
export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  content_type?: string;
}
export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  author: DiscordAuthor;
  attachments?: DiscordAttachment[];
  type?: number;
}
export interface DiscordChannel {
  id: string;
  name?: string;
  type: number;
  guild_id?: string;
}
export interface DiscordGuild {
  id: string;
  name: string;
}

export type FetchFn = typeof fetch;

export class DiscordClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    if (!token) throw new Error("DiscordClient requer um token (TYPER_DISCORD_TOKEN)");
  }

  private async req<T>(path: string, attempt = 0): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      headers: { authorization: `Bot ${this.token}`, "user-agent": "DiscordBot (typermagic-central-reunioes, 1.0)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && attempt < 3) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, Math.min(10_000, (body.retry_after ?? 1) * 1000)));
      return this.req<T>(path, attempt + 1);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Discord ${res.status} em ${path}: ${txt.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  me(): Promise<DiscordAuthor> {
    return this.req<DiscordAuthor>("/users/@me");
  }
  guilds(): Promise<DiscordGuild[]> {
    return this.req<DiscordGuild[]>("/users/@me/guilds");
  }
  channels(guildId: string): Promise<DiscordChannel[]> {
    return this.req<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  }

  /** acha o canal de texto pelo nome (sem acento/caixa) em todos os servidores onde o bot está */
  async findChannel(name: string): Promise<{ channel: DiscordChannel; guild: DiscordGuild } | null> {
    const want = normalize(name).replace(/\s/g, "-");
    for (const g of await this.guilds()) {
      for (const c of await this.channels(g.id)) {
        if (c.type !== 0) continue; // 0 = GUILD_TEXT
        if (normalize(c.name ?? "").replace(/\s/g, "-") === want) return { channel: c, guild: g };
      }
    }
    return null;
  }

  /** mensagens DEPOIS de `after` (snowflake), em ordem cronológica, paginando de 100 em 100 */
  async messagesAfter(channelId: string, after: string | null, max = 1000): Promise<DiscordMessage[]> {
    const out: DiscordMessage[] = [];
    let cursor = after;
    for (;;) {
      const q = cursor ? `?limit=100&after=${cursor}` : "?limit=100";
      const page = await this.req<DiscordMessage[]>(`/channels/${channelId}/messages${q}`);
      if (page.length === 0) break;
      page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      out.push(...page);
      cursor = page[page.length - 1]!.id;
      if (page.length < 100 || out.length >= max) break;
    }
    return out;
  }

  async fetchText(url: string): Promise<string> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`anexo ${res.status}`);
    return res.text();
  }
}

export interface Batch {
  authorId: string;
  authorName: string;
  messages: DiscordMessage[];
  first: Date;
  last: Date;
}

export const isTextAttachment = (a: DiscordAttachment): boolean =>
  /^text\//.test(a.content_type ?? "") || /\.(txt|md|vtt|srt|log|csv)$/i.test(a.filename);

/** Agrupa mensagens consecutivas do mesmo autor com intervalo < gapMs. */
export function groupBatches(msgs: DiscordMessage[], gapMs = 15 * 60_000): Batch[] {
  const sorted = [...msgs].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const out: Batch[] = [];
  for (const m of sorted) {
    if (!m.content?.trim() && !(m.attachments ?? []).some(isTextAttachment)) continue;
    const when = new Date(m.timestamp);
    const cur = out[out.length - 1];
    if (cur && cur.authorId === m.author.id && when.getTime() - cur.last.getTime() < gapMs) {
      cur.messages.push(m);
      cur.last = when;
    } else {
      out.push({ authorId: m.author.id, authorName: m.author.global_name || m.author.username, messages: [m], first: when, last: when });
    }
  }
  return out;
}

export const isSettled = (b: Batch, now: Date, settleMs = 10 * 60_000): boolean => now.getTime() - b.last.getTime() >= settleMs;

/** Lote → reunião crua (baixa anexos de texto). */
export async function batchToRaw(b: Batch, client: Pick<DiscordClient, "fetchText">, channelName: string): Promise<RawMeeting> {
  const parts: string[] = [];
  for (const m of b.messages) {
    if (m.content?.trim()) parts.push(m.content.trim());
    for (const a of m.attachments ?? []) {
      if (!isTextAttachment(a)) continue;
      try {
        parts.push(`[anexo ${a.filename}]\n${(await client.fetchText(a.url)).trim()}`);
      } catch (e) {
        parts.push(`[anexo ${a.filename}: não consegui baixar — ${e instanceof Error ? e.message : String(e)}]`);
      }
    }
  }
  const text = parts.join("\n\n");
  const title = titleFromText(text);
  return {
    sourceKey: `discord:${b.messages[0]!.id}`,
    platform: "discord",
    date: b.first.toISOString(),
    ...(title ? { title } : {}),
    text,
    origin: `Discord #${channelName} (colado por ${b.authorName})`,
  };
}
