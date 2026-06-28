// core/skills/store.ts
// Biblioteca de skills verificada. Indução destila um candidato; o selo é a
// porta — só a skill de uma tarefa que passou entra. Recuperação por embedding
// da tarefa mais uma checagem de aplicabilidade (selada e na versão de código
// atual), não só similaridade. Versionamento invalida skill de código velho.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { cosineSimilarity, type Embedder } from "@typer/index";
import { loadOrCreateIdentity, publicKeyId, type Identity } from "@typer/crypto";
import type { SealResult } from "@typer/seal";
import { serializeSkill, parseSkill } from "./skill-md.js";
import { signSkill, verifySkill } from "./signing.js";
import { capabilityDiff, type CapabilityDiff, type GrantLike } from "./registry.js";
import type { CompletedTask, Skill, SkillStore } from "./types.js";

interface Stored {
  skill: Skill;
  vector: number[];
  valid: boolean;
}

export interface VerifiedSkillStoreOptions {
  dir: string;
  embedder: Embedder;
  /** versão de código atual; skills de outra versão são invalidadas */
  currentCodeVersion?: string;
  /** similaridade mínima para considerar aplicável */
  threshold?: number;
  clock?: () => number;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "skill";
}

function embedText(s: Skill): string {
  return `${s.name}. ${s.description}\n${s.methodology}`;
}

export class VerifiedSkillStore implements SkillStore {
  private readonly map = new Map<string, Stored>();
  private readonly dir: string;
  private readonly embedder: Embedder;
  private currentCodeVersion: string | undefined;
  private readonly threshold: number;
  private readonly clock: () => number;
  private identity: Identity | null = null;

  constructor(opts: VerifiedSkillStoreOptions) {
    this.dir = opts.dir;
    this.embedder = opts.embedder;
    this.currentCodeVersion = opts.currentCodeVersion;
    this.threshold = opts.threshold ?? 0.05;
    this.clock = opts.clock ?? (() => Date.now());
  }

  private isValid(skill: Skill): boolean {
    if (this.currentCodeVersion === undefined) return true;
    return skill.codeVersion === this.currentCodeVersion;
  }

  /** Destila um candidato (ainda NÃO selado) de uma tarefa concluída. */
  induce(task: CompletedTask): Skill {
    const at = task.at ?? new Date(this.clock()).toISOString();
    const id = slug(task.name);
    return {
      id,
      name: task.name,
      description: task.description,
      methodology: task.methodology,
      codeVersion: task.codeVersion,
      sealed: false,
      createdAt: at,
    };
  }

  /** Identidade local (assina as skills induzidas aqui). Persiste em <dir>/.identity. */
  private async getIdentity(): Promise<Identity> {
    if (!this.identity) this.identity = await loadOrCreateIdentity(join(this.dir, ".identity"));
    return this.identity;
  }

  /** Confia numa chave pública de publisher (grava em <dir>/.publishers/<keyId>.pub). */
  private async trustPublisher(keyId: string, publicKeyPem: string): Promise<void> {
    const dir = join(this.dir, ".publishers");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${keyId.replace(/[^\w.-]/g, "_")}.pub`), publicKeyPem, "utf8");
  }

  /** Mapa keyId→pubKeyPem dos publishers confiáveis (inclui a identidade local). */
  private async loadPublishers(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const id = await this.getIdentity();
    out.set(id.keyId, id.publicKeyPem);
    try {
      for (const f of await readdir(join(this.dir, ".publishers"))) {
        if (!f.endsWith(".pub")) continue;
        const pem = await readFile(join(this.dir, ".publishers", f), "utf8").catch(() => "");
        if (pem) out.set(publicKeyId(pem), pem);
      }
    } catch {
      /* sem publishers extras */
    }
    return out;
  }

  /** Hashes revogados (skills banidas) — load() pula. */
  private async loadRevoked(): Promise<Set<string>> {
    try {
      const arr: unknown = JSON.parse(await readFile(join(this.dir, ".revoked.json"), "utf8"));
      return new Set(Array.isArray(arr) ? (arr as string[]) : []);
    } catch {
      return new Set();
    }
  }

  /** Revoga uma skill por hash: bane de futuros loads e remove da memória. */
  async revoke(hash: string): Promise<void> {
    const set = await this.loadRevoked();
    set.add(hash);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, ".revoked.json"), JSON.stringify([...set]), "utf8");
    for (const [id, s] of this.map) if (s.skill.hash === hash) this.map.delete(id);
  }

  /** A porta: a skill só entra na biblioteca se o selo passou. Assina com a
   *  identidade local e marca confinement "none" (induzida aqui = confiável). */
  async seal(skill: Skill, result: SealResult): Promise<Skill | null> {
    if (result.state !== "Verificado") return null; // rejeitada: nada entra
    const identity = await this.getIdentity();
    const signed = signSkill({ ...skill, sealed: true, confinement: "none" }, identity);
    await this.trustPublisher(identity.keyId, identity.publicKeyPem);
    const [vector] = await this.embedder.embed([embedText(signed)]);
    await this.persist(signed);
    this.map.set(signed.id, {
      skill: signed,
      vector: vector ?? [],
      valid: this.isValid(signed),
    });
    return signed;
  }

  /** Importa uma skill de FORA: verifica a assinatura do publisher, faz capability
   *  diff vs o grant, entra em QUARENTENA (microVM) e confia no publisher. Rejeita
   *  skill não assinada/adulterada ou cujas capacidades o usuário não concedeu. */
  async importSkill(
    skill: Skill,
    opts: { publisherPubKey: string; grant: GrantLike; approve?: (diff: CapabilityDiff) => boolean | Promise<boolean> },
  ): Promise<Skill> {
    if (!skill.signature || !skill.publisher) throw new Error("skill sem assinatura — recusada");
    if (publicKeyId(opts.publisherPubKey) !== skill.publisher) {
      throw new Error("a chave do publisher não corresponde ao id declarado na skill");
    }
    if (!verifySkill(skill, opts.publisherPubKey)) {
      throw new Error("assinatura inválida — skill adulterada ou chave errada");
    }
    const diff = capabilityDiff(skill.manifest, opts.grant);
    if (!diff.clean) {
      const ok = opts.approve ? await opts.approve(diff) : false;
      if (!ok) {
        throw new Error("import negado: capacidades não concedidas — " + JSON.stringify(diff.notGranted));
      }
    }
    const quarantined: Skill = { ...skill, confinement: "microvm" };
    await this.trustPublisher(skill.publisher, opts.publisherPubKey);
    const [vector] = await this.embedder.embed([embedText(quarantined)]);
    await this.persist(quarantined);
    this.map.set(quarantined.id, {
      skill: quarantined,
      vector: vector ?? [],
      valid: this.isValid(quarantined),
    });
    return quarantined;
  }

  /** Recupera skills aplicáveis: seladas, válidas, acima do limiar, ranqueadas. */
  async retrieve(task: string, k: number): Promise<Skill[]> {
    if (this.map.size === 0) return [];
    const [qv] = await this.embedder.embed([task]);
    if (!qv) return [];
    const scored: { skill: Skill; score: number }[] = [];
    for (const s of this.map.values()) {
      if (!s.skill.sealed || !s.valid) continue;
      const score = cosineSimilarity(qv, s.vector);
      if (score >= this.threshold) scored.push({ skill: s.skill, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((x) => x.skill);
  }

  /** Invalida skills que assumem uma versão de código diferente da atual. */
  invalidate(currentCodeVersion: string): number {
    this.currentCodeVersion = currentCodeVersion;
    let invalidated = 0;
    for (const s of this.map.values()) {
      const valid = this.isValid(s.skill);
      if (s.valid && !valid) invalidated++;
      s.valid = valid;
    }
    return invalidated;
  }

  async load(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    const revoked = await this.loadRevoked();
    const publishers = await this.loadPublishers();
    const found: Skill[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue; // .identity / .publishers / .revoked.json
      const raw = await readFile(join(this.dir, name, "SKILL.md"), "utf8").catch(() => "");
      const skill = parseSkill(raw);
      if (!skill || !skill.sealed) continue;
      // segurança: revogada → fora; assinatura ausente/de publisher desconhecido/
      // adulterada → NÃO carrega (skill não confiável nunca executa).
      if (skill.hash && revoked.has(skill.hash)) continue;
      const pem = skill.publisher ? publishers.get(skill.publisher) : undefined;
      if (!skill.signature || !pem || !verifySkill(skill, pem)) continue;
      found.push(skill);
    }
    if (found.length === 0) return;
    const vectors = await this.embedder.embed(found.map(embedText));
    found.forEach((skill, i) => {
      this.map.set(skill.id, {
        skill,
        vector: vectors[i] ?? [],
        valid: this.isValid(skill),
      });
    });
  }

  size(): number {
    return this.map.size;
  }

  private async persist(skill: Skill): Promise<void> {
    const subdir = join(this.dir, skill.id);
    await mkdir(subdir, { recursive: true });
    await writeFile(join(subdir, "SKILL.md"), serializeSkill(skill), "utf8");
  }
}

// hash auxiliar reservado para ids alternativos (não usado por ora)
export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}
