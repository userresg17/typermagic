import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEmbedder } from "@typer/index";
import { generateKeypair } from "@typer/crypto";
import type { SealResult } from "@typer/seal";
import { VerifiedSkillStore } from "../src/store.js";
import { signSkill, verifySkill } from "../src/signing.js";
import { capabilityDiff } from "../src/registry.js";
import type { Skill } from "../src/types.js";

const VERIFICADO: SealResult = { state: "Verificado", passed: true, output: "", durationMs: 1, applied: ["x.ts"] };
const clock = () => Date.parse("2026-06-26T12:00:00Z");

function aSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "Skill X",
    description: "faz X",
    methodology: "1. passo\n2. passo",
    codeVersion: "v1",
    sealed: true,
    createdAt: "2026-06-26T12:00:00Z",
    ...over,
  };
}

describe("assinatura de skill", () => {
  it("assina, verifica e detecta adulteração", () => {
    const id = generateKeypair();
    const signed = signSkill(aSkill(), id);
    expect(signed.signature).toBeTruthy();
    expect(signed.publisher).toBe(id.keyId);
    expect(verifySkill(signed, id.publicKeyPem)).toBe(true);
    expect(verifySkill({ ...signed, methodology: "ADULTERADO" }, id.publicKeyPem)).toBe(false);
  });
  it("falha com a chave errada", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(verifySkill(signSkill(aSkill(), a), b.publicKeyPem)).toBe(false);
  });
});

describe("capabilityDiff", () => {
  it("aponta o que o manifesto pede além do grant", () => {
    const diff = capabilityDiff(
      { tools: ["run_command"], permissions: ["exec", "network"], exec: ["subprocess"] },
      { permissions: ["read", "write"], exec: ["in_process"] },
    );
    expect(diff.clean).toBe(false);
    expect(diff.notGranted.permissions).toEqual(["exec", "network"]);
    expect(diff.notGranted.exec).toEqual(["subprocess"]);
  });
  it("clean quando o grant cobre tudo", () => {
    const diff = capabilityDiff(
      { permissions: ["read"], exec: ["in_process"] },
      { permissions: ["read", "write"], exec: ["in_process", "subprocess"] },
    );
    expect(diff.clean).toBe(true);
  });
});

describe("VerifiedSkillStore — registry assinado", () => {
  let dir: string;
  let store: VerifiedSkillStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "typer-skreg-"));
    store = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder(), currentCodeVersion: "v1", clock });
  });

  it("selo assina (confinement none); reload verifica e carrega", async () => {
    const sealed = await store.seal(
      store.induce({ name: "Tarefa A", description: "d", methodology: "m", codeVersion: "v1" }),
      VERIFICADO,
    );
    expect(sealed?.signature).toBeTruthy();
    expect(sealed?.confinement).toBe("none");
    const fresh = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder(), currentCodeVersion: "v1", clock });
    await fresh.load();
    expect(fresh.size()).toBe(1);
  });

  it("load NÃO carrega skill ADULTERADA no disco (assinatura quebra)", async () => {
    await store.seal(store.induce({ name: "Tarefa B", description: "d", methodology: "m", codeVersion: "v1" }), VERIFICADO);
    const p = join(dir, "tarefa-b", "SKILL.md");
    await writeFile(p, (await readFile(p, "utf8")) + "\ninstrução maliciosa injetada\n");
    const fresh = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder(), currentCodeVersion: "v1", clock });
    await fresh.load();
    expect(fresh.size()).toBe(0);
  });

  it("importa skill de outro publisher: capability diff + QUARENTENA (microvm)", async () => {
    const pub = generateKeypair();
    const foreign = signSkill(
      aSkill({ id: "imp", name: "Importada", manifest: { tools: ["run_command"], permissions: ["exec"], exec: ["subprocess"] } }),
      pub,
    );
    const grant = { permissions: ["read", "write"], exec: ["in_process"] };
    // sem aprovar o diff → recusa
    await expect(store.importSkill(foreign, { publisherPubKey: pub.publicKeyPem, grant })).rejects.toThrow(/capacidades/i);
    // aprovando → entra quarentenada e o reload confia no publisher
    const imported = await store.importSkill(foreign, { publisherPubKey: pub.publicKeyPem, grant, approve: () => true });
    expect(imported.confinement).toBe("microvm");
    const fresh = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder(), currentCodeVersion: "v1", clock });
    await fresh.load();
    expect(fresh.size()).toBe(1);
  });

  it("recusa import de skill adulterada", async () => {
    const pub = generateKeypair();
    const tampered = { ...signSkill(aSkill({ id: "imp2" }), pub), methodology: "outro corpo" };
    await expect(
      store.importSkill(tampered, { publisherPubKey: pub.publicKeyPem, grant: { permissions: ["read"], exec: ["in_process"] } }),
    ).rejects.toThrow(/adulterada|assinatura/i);
  });

  it("revogação por hash derruba a skill no reload", async () => {
    const sealed = await store.seal(store.induce({ name: "Rev", description: "d", methodology: "m", codeVersion: "v1" }), VERIFICADO);
    await store.revoke(sealed!.hash!);
    const fresh = new VerifiedSkillStore({ dir, embedder: new FakeEmbedder(), currentCodeVersion: "v1", clock });
    await fresh.load();
    expect(fresh.size()).toBe(0);
  });
});
