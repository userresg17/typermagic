// core/meetings/hub.ts — o orquestrador. Recebe reuniões cruas de qualquer fonte, resume
// com o modelo, grava na pasta única, reconstrói o índice e avisa (Telegram). Também faz
// o polling do Discord e do Drive com estado persistido em .central/estado.json.
// Falha em UMA fonte nunca derruba as outras (cada poll é isolado e logado).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MeetingStore, PLATFORM_LABEL, type SearchHit, type SearchOptions } from "./store.js";
import { summarizeMeeting, type SummarizeOptions } from "./summarize.js";
import { DiscordClient, groupBatches, isSettled, batchToRaw } from "./discord.js";
import { DriveClient, driveFileToRaw } from "./google.js";
import { shortHash, titleFromText } from "./text.js";
import type { Llm, Meeting, Platform, RawMeeting } from "./types.js";

export interface HubState {
  discord?: { channelId?: string; channelName?: string; lastId?: string; lastPoll?: string; lastError?: string };
  drive?: { since?: string; lastPoll?: string; lastError?: string };
}

export interface DiscordSourceConfig {
  client: DiscordClient;
  /** nome do canal (ex.: "transcrições") — resolvido uma vez e guardado no estado */
  channelName: string;
  /** id direto (pula a busca por nome) */
  channelId?: string;
  gapMs?: number;
  settleMs?: number;
}
export interface DriveSourceConfig {
  client: DriveClient;
  /** termos no nome do doc (default ["Gemini"]) */
  nameMatch?: string[];
}

export interface HubOptions {
  dir: string;
  llm: Llm;
  /** avisa o dono (Telegram). Ausente = silencioso. */
  notify?: (text: string) => Promise<void>;
  log?: (m: string) => void;
  discord?: DiscordSourceConfig;
  drive?: DriveSourceConfig;
  summarize?: SummarizeOptions;
  now?: () => Date;
}

export interface IngestResult {
  meeting: Meeting;
  duplicate: boolean;
  /** texto já formatado p/ o Telegram (vazio se duplicada) */
  message: string;
}

const TG_MAX = 3800;

/** Mensagem do resumo p/ o Telegram (texto puro; sem markdown p/ não quebrar no parse). */
export function formatSummaryMessage(m: Meeting): string {
  const s = m.summary;
  const lines = [
    `📋 Reunião nova — ${PLATFORM_LABEL[m.platform]} · ${m.date.slice(0, 16).replace("T", " ")}`,
    s.titulo,
    `👥 ${s.participantes.join(", ") || "participantes não identificados"}`,
    "",
    `📝 ${s.resumo}`,
  ];
  if (s.decisoes.length) lines.push("", "✅ Decisões:", ...s.decisoes.map((d) => `• ${d}`));
  if (s.pendencias.length) lines.push("", "⏳ Pendências:", ...s.pendencias.map((p) => `• ${p.oQue} — ${p.responsavel}${p.prazo ? ` (${p.prazo})` : ""}`));
  if (s.proximosPassos.length) lines.push("", "➡️ Próximos passos:", ...s.proximosPassos.map((p) => `• ${p}`));
  if (s.idioma !== "pt") lines.push("", `🌐 Original em "${s.idioma}"${m.textPt ? " — traduzido integralmente no arquivo" : ""}.`);
  lines.push("", `📄 ${m.file}`);
  const text = lines.join("\n");
  if (text.length <= TG_MAX) return text;
  const tail = `\n[…]\n📄 ${m.file}`;
  return text.slice(0, TG_MAX - tail.length) + tail;
}

export class MeetingsHub {
  readonly store: MeetingStore;
  private readonly log: (m: string) => void;
  private readonly now: () => Date;
  private polling = false;

  constructor(readonly opts: HubOptions) {
    this.store = new MeetingStore(opts.dir);
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? (() => new Date());
  }

  get dir(): string {
    return this.opts.dir;
  }

  private get statePath(): string {
    return join(this.opts.dir, ".central", "estado.json");
  }

  async state(): Promise<HubState> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as HubState;
    } catch {
      return {};
    }
  }

  private async saveState(patch: (s: HubState) => void): Promise<void> {
    const s = await this.state();
    patch(s);
    await mkdir(join(this.opts.dir, ".central"), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(s, null, 2));
  }

  /** Ingestão completa de uma reunião crua: dedupe → resumo → arquivo → índice → aviso. */
  async ingest(raw: RawMeeting): Promise<IngestResult> {
    await this.store.init();
    if (await this.store.has(raw.sourceKey)) {
      const prev = (await this.store.ingested())[raw.sourceKey]!;
      const meeting = (await this.store.read(prev))!;
      this.log(`duplicada (${raw.sourceKey}) → ${meeting.id}`);
      return { meeting, duplicate: true, message: "" };
    }
    if (!raw.text.trim()) throw new Error("reunião sem texto");
    this.log(`resumindo ${raw.platform} ${raw.sourceKey} (${raw.text.length} chars)…`);
    const r = await summarizeMeeting(raw, this.opts.llm, this.opts.summarize ?? {});
    const { meeting, duplicate } = await this.store.save(raw, r.summary, r.textPt);
    if (duplicate) return { meeting, duplicate: true, message: "" };
    const message = formatSummaryMessage(meeting);
    this.log(`salva: ${meeting.file} (${r.calls} chamada(s) de modelo)`);
    if (this.opts.notify) await this.opts.notify(message).catch((e) => this.log(`aviso falhou: ${e instanceof Error ? e.message : String(e)}`));
    return { meeting, duplicate: false, message };
  }

  /** Texto colado/encaminhado (WhatsApp via Telegram, ou arquivo local). */
  ingestText(text: string, opts: { platform?: Platform; title?: string; date?: Date; origin?: string } = {}): Promise<IngestResult> {
    const t = text.trim();
    const title = opts.title ?? titleFromText(t) ?? undefined;
    const date = opts.date ?? this.now();
    return this.ingest({
      sourceKey: `${opts.platform ?? "whatsapp"}:${shortHash(t)}`,
      platform: opts.platform ?? "whatsapp",
      date: date.toISOString(),
      ...(title ? { title } : {}),
      text: t,
      origin: opts.origin ?? "encaminhado pelo Telegram (resumo do WhatsApp)",
    });
  }

  // ------------------------------------------------------------ fontes

  async pollDiscord(): Promise<{ ingested: number; pending: number }> {
    const cfg = this.opts.discord;
    if (!cfg) return { ingested: 0, pending: 0 };
    const st = (await this.state()).discord ?? {};
    let channelId = cfg.channelId ?? st.channelId;
    let channelName = cfg.channelName;
    if (!channelId) {
      const found = await cfg.client.findChannel(cfg.channelName);
      if (!found) throw new Error(`canal "#${cfg.channelName}" não encontrado em nenhum servidor onde o bot está (convide o bot e confira o nome)`);
      channelId = found.channel.id;
      channelName = found.channel.name ?? cfg.channelName;
      this.log(`Discord: canal #${channelName} = ${channelId} (servidor ${found.guild.name})`);
    }
    const msgs = await cfg.client.messagesAfter(channelId, st.lastId ?? null);
    if (msgs.length && msgs.every((m) => !m.content && !(m.attachments ?? []).length)) {
      throw new Error("as mensagens vieram sem conteúdo — ative o 'Message Content Intent' do bot no Developer Portal (Bot → Privileged Gateway Intents)");
    }
    const batches = groupBatches(msgs, cfg.gapMs);
    const now = this.now();
    let ingested = 0;
    let pending = 0;
    let lastId = st.lastId;
    for (const b of batches) {
      if (!isSettled(b, now, cfg.settleMs)) {
        pending++;
        break; // lotes seguintes também são mais novos: espera assentar
      }
      const raw = await batchToRaw(b, cfg.client, channelName);
      try {
        const r = await this.ingest(raw);
        if (!r.duplicate) ingested++;
        lastId = b.messages[b.messages.length - 1]!.id;
      } catch (e) {
        this.log(`Discord: falha ao ingerir lote ${raw.sourceKey}: ${e instanceof Error ? e.message : String(e)}`);
        break; // não avança o cursor por cima de um lote que falhou
      }
    }
    // mensagens vazias/ignoradas antes do 1º lote pendente também avançam o cursor
    if (batches.length === 0 && msgs.length) lastId = msgs[msgs.length - 1]!.id;
    await this.saveState((s) => {
      s.discord = { channelId, channelName, lastPoll: now.toISOString(), ...(lastId ? { lastId } : {}) };
    });
    return { ingested, pending };
  }

  async pollDrive(): Promise<{ ingested: number }> {
    const cfg = this.opts.drive;
    if (!cfg) return { ingested: 0 };
    const st = (await this.state()).drive ?? {};
    const now = this.now();
    // 1ª rodada: só docs dos últimos 14 dias (não reingere o histórico inteiro de uma vez)
    const since = st.since ?? new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const files = await cfg.client.listNotes({ nameMatch: cfg.nameMatch ?? ["Gemini"], since });
    let ingested = 0;
    let newest = since;
    for (const f of files) {
      if (await this.store.has(`meet:${f.id}`)) {
        if (f.modifiedTime > newest) newest = f.modifiedTime;
        continue;
      }
      // doc recém-criado pode ainda estar sendo escrito pelo Gemini: espera 10 min de quietude
      if (now.getTime() - new Date(f.modifiedTime).getTime() < 10 * 60_000) continue;
      try {
        const text = await cfg.client.exportText(f.id);
        const r = await this.ingest(driveFileToRaw(f, text));
        if (!r.duplicate) ingested++;
        if (f.modifiedTime > newest) newest = f.modifiedTime;
      } catch (e) {
        this.log(`Drive: falha em "${f.name}": ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    await this.saveState((s) => {
      s.drive = { since: newest, lastPoll: now.toISOString() };
    });
    return { ingested };
  }

  /** Uma rodada em todas as fontes configuradas. Erro de uma fonte vira log + estado, não exceção. */
  async pollOnce(): Promise<{ discord?: { ingested: number; pending: number } | { error: string }; drive?: { ingested: number } | { error: string } }> {
    if (this.polling) return {};
    this.polling = true;
    const out: Awaited<ReturnType<MeetingsHub["pollOnce"]>> = {};
    try {
      if (this.opts.discord) {
        try {
          out.discord = await this.pollDiscord();
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          out.discord = { error };
          this.log(`Discord: ${error}`);
          await this.saveState((s) => {
            s.discord = { ...(s.discord ?? {}), lastError: error };
          });
        }
      }
      if (this.opts.drive) {
        try {
          out.drive = await this.pollDrive();
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          out.drive = { error };
          this.log(`Drive: ${error}`);
          await this.saveState((s) => {
            s.drive = { ...(s.drive ?? {}), lastError: error };
          });
        }
      }
    } finally {
      this.polling = false;
    }
    return out;
  }

  /** Loop de vigia (serviço). Para com o signal. */
  async watch(intervalMs: number, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      await this.pollOnce();
      await new Promise<void>((r) => {
        const t = setTimeout(r, intervalMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          r();
        }, { once: true });
      });
    }
  }

  // ------------------------------------------------------------ consulta (ferramentas do agente)

  search(query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    return this.store.search(query, opts);
  }
  read(id: string): Promise<Meeting | null> {
    return this.store.read(id);
  }
  list(): Promise<Meeting[]> {
    return this.store.list();
  }
}
