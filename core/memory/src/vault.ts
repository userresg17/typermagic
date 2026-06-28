// core/memory/vault.ts
// Persistência em markdown com frontmatter, na linha do Memory Bank: auditável,
// portátil, versionável em Git, legível por humano e por agente. Sem dependência
// de YAML — parser/serializer mínimo para os campos da entrada.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryEntry, MemoryKind } from "./types.js";

function serialize(entry: MemoryEntry): string {
  const lines = [
    "---",
    `id: ${entry.id}`,
    `kind: ${entry.kind}`,
    `at: ${entry.at}`,
    `importance: ${entry.importance}`,
    `confidence: ${entry.confidence}`,
    `source: ${entry.source}`,
    `verified: ${entry.verified}`,
  ];
  // memória v2: title e tags no frontmatter (links NÃO — vêm do corpo [[ ]]).
  if (entry.title) lines.push(`title: ${entry.title}`);
  if (entry.tags && entry.tags.length > 0) lines.push(`tags: ${entry.tags.join(", ")}`);
  lines.push("---", "");
  return lines.join("\n") + entry.text + "\n";
}

function parse(raw: string): MemoryEntry | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const text = (m[2] ?? "").replace(/\n$/, "");
  if (!fields.id || !fields.kind) return null;
  const tags = fields.tags
    ? fields.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
    : undefined;
  return {
    id: fields.id,
    kind: fields.kind as MemoryKind,
    text,
    at: fields.at ?? "",
    importance: Number(fields.importance ?? 0),
    confidence: Number(fields.confidence ?? 0),
    source: fields.source ?? "",
    verified: fields.verified === "true",
    ...(fields.title ? { title: fields.title } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

function dirFor(root: string, kind: MemoryKind): string {
  return join(root, kind === "episodic" ? "episodic" : "semantic");
}

export async function writeEntry(root: string, entry: MemoryEntry): Promise<void> {
  const dir = dirFor(root, entry.kind);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${entry.id}.md`), serialize(entry), "utf8");
}

export async function readAll(root: string): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  for (const kind of ["episodic", "semantic"] as const) {
    const dir = dirFor(root, kind);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue; // dir ainda não existe
    }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const raw = await readFile(join(dir, f), "utf8").catch(() => "");
      const entry = parse(raw);
      if (entry) out.push(entry);
    }
  }
  return out;
}
