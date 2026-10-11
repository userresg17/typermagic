// core/skills/skill-md.ts
// Serializa/lê uma skill no formato SKILL.md: frontmatter com metadados + corpo
// com a metodologia. Portátil e legível, o mesmo formato de Agent Skills. Os campos
// do registry assinado (manifest/signature/publisher/hash/confinement) entram no
// frontmatter quando presentes — compatível com .md antigos (campos opcionais).

import type { CapabilityManifest, GuiStep, Skill, SkillSource } from "./types.js";

export function serializeSkill(skill: Skill): string {
  const fm = [
    "---",
    `id: ${skill.id}`,
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `codeVersion: ${skill.codeVersion}`,
    `sealed: ${skill.sealed}`,
    `createdAt: ${skill.createdAt}`,
  ];
  if (skill.manifest) fm.push(`manifest: ${JSON.stringify(skill.manifest)}`);
  if (skill.confinement) fm.push(`confinement: ${skill.confinement}`);
  if (skill.publisher) fm.push(`publisher: ${skill.publisher}`);
  if (skill.hash) fm.push(`hash: ${skill.hash}`);
  if (skill.signature) fm.push(`signature: ${skill.signature}`);
  // skills de GUI (Fase 7): campos estruturados em JSON numa linha cada (o parser é linha-a-linha)
  if (skill.kind) fm.push(`kind: ${skill.kind}`);
  if (skill.app) fm.push(`app: ${skill.app}`);
  if (skill.appVersion) fm.push(`appVersion: ${skill.appVersion}`);
  if (skill.state) fm.push(`state: ${skill.state}`);
  if (skill.steps) fm.push(`steps: ${JSON.stringify(skill.steps)}`);
  if (skill.sources) fm.push(`sources: ${JSON.stringify(skill.sources)}`);
  if (skill.lastRehearsal) fm.push(`lastRehearsal: ${JSON.stringify(skill.lastRehearsal)}`);
  fm.push("---", "");
  return [...fm, skill.methodology, ""].join("\n");
}

export function parseSkill(raw: string): Skill | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const f: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    f[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!f.id || !f.name) return null;

  let manifest: CapabilityManifest | undefined;
  if (f.manifest) {
    try {
      manifest = JSON.parse(f.manifest) as CapabilityManifest;
    } catch {
      manifest = undefined;
    }
  }
  const confinement =
    f.confinement === "none" || f.confinement === "subprocess" || f.confinement === "microvm"
      ? f.confinement
      : undefined;

  const json = <T>(key: string): T | undefined => {
    if (!f[key]) return undefined;
    try {
      return JSON.parse(f[key]!) as T;
    } catch {
      return undefined;
    }
  };
  const steps = json<GuiStep[]>("steps");
  const sources = json<SkillSource[]>("sources");
  const lastRehearsal = json<{ at: string; passed: boolean; reason?: string }>("lastRehearsal");
  const state = f.state === "candidate" || f.state === "sealed" ? f.state : undefined;

  return {
    id: f.id,
    name: f.name,
    description: f.description ?? "",
    methodology: (m[2] ?? "").trim(),
    codeVersion: f.codeVersion ?? "",
    sealed: f.sealed === "true",
    createdAt: f.createdAt ?? "",
    ...(manifest ? { manifest } : {}),
    ...(confinement ? { confinement } : {}),
    ...(f.publisher ? { publisher: f.publisher } : {}),
    ...(f.hash ? { hash: f.hash } : {}),
    ...(f.signature ? { signature: f.signature } : {}),
    ...(f.kind === "gui" ? { kind: "gui" as const } : {}),
    ...(f.app ? { app: f.app } : {}),
    ...(f.appVersion ? { appVersion: f.appVersion } : {}),
    ...(state ? { state } : {}),
    ...(Array.isArray(steps) ? { steps } : {}),
    ...(Array.isArray(sources) ? { sources } : {}),
    ...(lastRehearsal ? { lastRehearsal } : {}),
  };
}
