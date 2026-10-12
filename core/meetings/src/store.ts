// core/meetings/store.ts — a pasta única. Cada reunião é UM arquivo .md legível
// (frontmatter + resumo + transcrição completa); o índice REUNIOES.md é DERIVADO dos
// arquivos (reconstruído a cada mudança), então dois processos (gateway + watcher)
// podem escrever sem corromper nada: arquivos têm nome único e o índice é regenerado
// sob um lock de diretório. Deduplicação por sourceKey em .central/ingeridos.json.

import { mkdir, readFile, writeFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Meeting, Platform, RawMeeting, Summary } from "./types.js";
import { datePrefix, localIso, slugify, tokenize, normalize } from "./text.js";

export const INDEX_FILE = "REUNIOES.md";
const STATE_DIR = ".central";
const INGESTED_FILE = "ingeridos.json";

export const PLATFORM_LABEL: Record<Platform, string> = {
  discord: "Discord",
  meet: "Google Meet",
  whatsapp: "WhatsApp",
  arquivo: "Arquivo",
};

export interface SearchHit {
  meeting: Meeting;
  score: number;
  /** trecho em volta do melhor match (p/ o modelo citar) */
  snippet: string;
}

export interface SearchOptions {
  k?: number;
  platform?: Platform;
  /** ISO ou AAAA-MM-DD (inclusive) */
  since?: string;
  until?: string;
}

/** Lock simples por mkdir (atômico no mesmo FS). Lock mais velho que staleMs é considerado órfão. */
export async function withLock<T>(dir: string, fn: () => Promise<T>, opts: { staleMs?: number; timeoutMs?: number } = {}): Promise<T> {
  const lock = join(dir, STATE_DIR, "lock");
  const stale = opts.staleMs ?? 60_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  await mkdir(join(dir, STATE_DIR), { recursive: true });
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch {
      try {
        const s = await stat(lock);
        if (Date.now() - s.mtimeMs > stale) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // sumiu entre o mkdir e o stat: tenta de novo
      }
      if (Date.now() > deadline) throw new Error(`lock da central ocupado há mais de ${Math.round((opts.timeoutMs ?? 30_000) / 1000)}s: ${lock}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/** escrita atômica: tmp + rename (um leitor nunca vê arquivo pela metade) */
async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

// ---------------------------------------------------------------- formato do arquivo

function fm(key: string, value: string): string {
  return `${key}: ${value.replace(/\r?\n/g, " ").trim()}`;
}

/** Serializa a reunião no .md. Frontmatter simples (chave: valor) — legível no bloco de notas. */
export function renderMeeting(m: Meeting): string {
  const s = m.summary;
  const parts: string[] = [
    "---",
    fm("id", m.id),
    fm("data", m.date),
    fm("plataforma", m.platform),
    fm("titulo", s.titulo),
    fm("participantes", s.participantes.join(", ")),
    fm("idioma", s.idioma),
    fm("origem", m.origin ?? ""),
    fm("fonte", m.sourceKey),
    fm("ingerido_em", m.ingestedAt),
    "---",
    "",
    `# ${s.titulo}`,
    "",
    `**Data:** ${m.date.slice(0, 16).replace("T", " ")} · **Plataforma:** ${PLATFORM_LABEL[m.platform]} · **Participantes:** ${s.participantes.join(", ") || "—"}`,
    "",
    "## Resumo",
    "",
    s.resumo || "—",
    "",
    "## Decisões",
    "",
    ...(s.decisoes.length ? s.decisoes.map((d) => `- ${d}`) : ["- (nenhuma registrada)"]),
    "",
    "## Pendências",
    "",
    ...(s.pendencias.length ? s.pendencias.map((p) => `- [ ] ${p.oQue} — **${p.responsavel || "sem responsável"}**${p.prazo ? ` (prazo: ${p.prazo})` : ""}`) : ["- (nenhuma registrada)"]),
    "",
  ];
  if (s.proximosPassos.length) parts.push("## Próximos passos", "", ...s.proximosPassos.map((p) => `- ${p}`), "");
  if (m.textPt) parts.push("## Tradução (pt-BR)", "", m.textPt.trim(), "");
  parts.push(`## Transcrição completa${s.idioma && s.idioma !== "pt" ? ` (original em ${s.idioma})` : ""}`, "", m.text.trim(), "");
  return parts.join("\n");
}

interface Parsed {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): Parsed | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const meta: Record<string, string> = {};
  for (const line of content.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: content.slice(end + 5) };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** extrai a seção "## Título" do corpo (até o próximo "## ") */
function section(body: string, title: string): string {
  const re = new RegExp(`^## ${escapeRe(title)}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  const m = body.match(re);
  return m?.[1]?.trim() ?? "";
}

const bullets = (s: string): string[] =>
  s
    .split("\n")
    .map((l) => l.replace(/^-\s*(\[[ x]\]\s*)?/, "").trim())
    .filter((l) => l && !/^\(nenhuma/.test(l));

/** Lê um .md de volta p/ Meeting (p/ busca/índice funcionarem a partir dos arquivos). */
export function parseMeeting(content: string, file: string): Meeting | null {
  const p = parseFrontmatter(content);
  if (!p) return null;
  const { meta, body } = p;
  const platform = (["discord", "meet", "whatsapp", "arquivo"].includes(meta.plataforma ?? "") ? meta.plataforma : "arquivo") as Platform;
  const pend = bullets(section(body, "Pendências")).map((l) => {
    const m = l.match(/^(.*?)\s+—\s+\*\*(.*?)\*\*(?:\s+\(prazo:\s*(.*?)\))?$/);
    return m ? { oQue: m[1]!.trim(), responsavel: m[2]!.trim(), ...(m[3] ? { prazo: m[3].trim() } : {}) } : { oQue: l, responsavel: "" };
  });
  const summary: Summary = {
    titulo: meta.titulo ?? basename(file, ".md"),
    participantes: (meta.participantes ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    idioma: meta.idioma ?? "pt",
    resumo: section(body, "Resumo"),
    decisoes: bullets(section(body, "Decisões")),
    pendencias: pend,
    proximosPassos: bullets(section(body, "Próximos passos")),
  };
  const textPt = section(body, "Tradução (pt-BR)");
  const text = section(body, "Transcrição completa");
  return {
    id: meta.id ?? basename(file, ".md"),
    file,
    sourceKey: meta.fonte ?? "",
    platform,
    date: meta.data ?? "",
    title: summary.titulo,
    participants: summary.participantes,
    text,
    ...(meta.origem ? { origin: meta.origem } : {}),
    summary,
    ...(textPt ? { textPt } : {}),
    ingestedAt: meta.ingerido_em ?? "",
  };
}

// ---------------------------------------------------------------- índice

export function renderIndex(meetings: Meeting[], now = new Date()): string {
  const sorted = [...meetings].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const lines: string[] = [
    "# Central de Reuniões — índice",
    "",
    `Atualizado em ${localIso(now).slice(0, 16).replace("T", " ")} · ${sorted.length} reunião(ões). Cada entrada aponta para o arquivo completo na mesma pasta.`,
    "",
  ];
  for (const m of sorted) {
    const s = m.summary;
    lines.push(
      `## ${m.date.slice(0, 10)} · ${PLATFORM_LABEL[m.platform]} · ${s.titulo}`,
      `Participantes: ${s.participantes.join(", ") || "—"}`,
      `Arquivo: ${basename(m.file)}`,
      `Resumo: ${s.resumo.replace(/\s+/g, " ").slice(0, 400)}`,
    );
    if (s.decisoes.length) lines.push("Decisões:", ...s.decisoes.map((d) => `  • ${d}`));
    if (s.pendencias.length) lines.push("Pendências:", ...s.pendencias.map((p) => `  • ${p.oQue} — ${p.responsavel || "sem responsável"}${p.prazo ? ` (${p.prazo})` : ""}`));
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- store

export class MeetingStore {
  constructor(readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.dir, STATE_DIR), { recursive: true });
  }

  get indexPath(): string {
    return join(this.dir, INDEX_FILE);
  }

  private get ingestedPath(): string {
    return join(this.dir, STATE_DIR, INGESTED_FILE);
  }

  async ingested(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.ingestedPath, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async has(sourceKey: string): Promise<boolean> {
    return sourceKey in (await this.ingested());
  }

  /** id único: prefixo de data + plataforma + slug; colisão ganha sufixo -2, -3… */
  private async uniqueId(date: Date, platform: Platform, title: string): Promise<string> {
    const base = `${datePrefix(date)}_${platform}_${slugify(title)}`;
    const existing = new Set((await this.list()).map((m) => m.id));
    let id = base;
    for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** Grava a reunião (arquivo + dedupe + índice). Idempotente por sourceKey. */
  async save(raw: RawMeeting, summary: Summary, textPt?: string): Promise<{ meeting: Meeting; duplicate: boolean }> {
    await this.init();
    return withLock(this.dir, async () => {
      const done = await this.ingested();
      if (raw.sourceKey in done) {
        const prev = await this.read(done[raw.sourceKey]!);
        if (prev) return { meeting: prev, duplicate: true };
      }
      const d = new Date(raw.date);
      const when = Number.isNaN(d.getTime()) ? new Date() : d;
      const id = await this.uniqueId(when, raw.platform, summary.titulo);
      const file = join(this.dir, `${id}.md`);
      const meeting: Meeting = {
        ...raw,
        date: localIso(when),
        id,
        file,
        summary,
        ...(textPt ? { textPt } : {}),
        ingestedAt: localIso(new Date()),
      };
      await writeAtomic(file, renderMeeting(meeting));
      done[raw.sourceKey] = id;
      await writeAtomic(this.ingestedPath, JSON.stringify(done, null, 2));
      await this.rebuildIndexUnlocked();
      return { meeting, duplicate: false };
    });
  }

  private async rebuildIndexUnlocked(): Promise<void> {
    const all = await this.list();
    await writeAtomic(this.indexPath, renderIndex(all));
  }

  async rebuildIndex(): Promise<void> {
    await this.init();
    await withLock(this.dir, () => this.rebuildIndexUnlocked());
  }

  /** todas as reuniões (lidas dos arquivos), mais recente primeiro */
  async list(): Promise<Meeting[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: Meeting[] = [];
    for (const n of names) {
      if (!n.endsWith(".md") || n === INDEX_FILE || n.startsWith(".")) continue;
      const file = join(this.dir, n);
      try {
        const m = parseMeeting(await readFile(file, "utf8"), file);
        if (m) out.push(m);
      } catch {
        /* arquivo pela metade ou alheio: ignora */
      }
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  async read(id: string): Promise<Meeting | null> {
    const safe = basename(id).replace(/\.md$/, "");
    const file = join(this.dir, `${safe}.md`);
    try {
      return parseMeeting(await readFile(file, "utf8"), file);
    } catch {
      return null;
    }
  }

  /** Busca lexical (sem modelo): título/participantes/decisões pesam mais que o corpo. */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const q = tokenize(query);
    let all = await this.list();
    if (opts.platform) all = all.filter((m) => m.platform === opts.platform);
    if (opts.since) all = all.filter((m) => m.date.slice(0, 10) >= opts.since!.slice(0, 10));
    if (opts.until) all = all.filter((m) => m.date.slice(0, 10) <= opts.until!.slice(0, 10));
    const k = opts.k ?? 5;
    if (q.length === 0) return all.slice(0, k).map((m) => ({ meeting: m, score: 0, snippet: m.summary.resumo.slice(0, 300) }));
    const hits: SearchHit[] = [];
    for (const m of all) {
      const s = m.summary;
      const head = normalize(`${s.titulo} ${s.participantes.join(" ")} ${s.decisoes.join(" ")} ${s.pendencias.map((p) => `${p.oQue} ${p.responsavel}`).join(" ")}`);
      const bodyText = m.textPt ?? m.text;
      const body = normalize(`${s.resumo} ${bodyText}`);
      let score = 0;
      let firstPos = -1;
      for (const t of q) {
        if (head.includes(t)) score += 3;
        const pos = body.indexOf(t);
        if (pos >= 0) {
          score += 1;
          if (firstPos < 0 || pos < firstPos) firstPos = pos;
        }
      }
      if (score === 0) continue;
      const src = `${s.resumo}\n${bodyText}`;
      const at = firstPos >= 0 ? Math.max(0, Math.min(firstPos, src.length - 1)) : 0;
      const snippet = src.slice(Math.max(0, at - 120), at + 280).replace(/\s+/g, " ").trim();
      hits.push({ meeting: m, score, snippet });
    }
    hits.sort((a, b) => b.score - a.score || (a.meeting.date < b.meeting.date ? 1 : -1));
    return hits.slice(0, k);
  }
}
