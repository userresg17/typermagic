// core/learn/setup.ts
// Resolução de configuração compartilhada entre CLI e gateway: pastas de trabalho,
// modelos (visão barata × destilação forte) e provider. Mantida aqui para as duas
// superfícies não divergirem.

import { homedir } from "node:os";
import { join } from "node:path";
import { buildProviders, type Provider } from "@typer/router";

export interface LearnSetup {
  workDir: string;
  skillsDir: string;
  visionModel: string;
  distillModel: string;
  provider: Provider;
  providerId: string;
}

export function defaultWorkDir(): string {
  const v = process.env.TYPER_LEARN_DIR?.trim();
  return v ? v.replace(/^~(?=$|\/)/, homedir()) : join(homedir(), ".typer", "learn");
}

/** Modelos: visão usa um modelo médio por padrão (muitos frames); destilação usa o
 *  modelo principal (TYPER_MODEL) — é o passo que define a qualidade da skill. */
export function resolveModels(providerId: string, mainModel: string | null | undefined): { visionModel: string; distillModel: string } {
  // variável vazia no .env conta como ausente (o .env.example traz as chaves em branco)
  const env = (k: string): string | undefined => (process.env[k]?.trim() ? process.env[k]!.trim() : undefined);
  const vision =
    env("TYPER_LEARN_VISION_MODEL") ??
    (providerId === "anthropic" ? "claude-sonnet-5-5" : providerId === "openai" ? "gpt-4.1-mini" : mainModel ?? "");
  const distill = env("TYPER_LEARN_MODEL") ?? (mainModel?.trim() || undefined) ?? (providerId === "anthropic" ? "claude-opus-5-5" : vision);
  return { visionModel: vision || distill, distillModel: distill };
}

export async function setupLearn(opts: { root: string; provider?: string | null | undefined; model?: string | null | undefined; local?: boolean | undefined }): Promise<LearnSetup> {
  const built = await buildProviders(opts.local ?? false, opts.provider ?? null);
  const providerId = built.preferred;
  const provider = built.providers[providerId]!;
  if (providerId === "fake") throw new Error("sem provider de modelo configurado (defina TYPER_ANTHROPIC_KEY ou TYPER_OPENAI_KEY)");
  const { visionModel, distillModel } = resolveModels(providerId, opts.model);
  return {
    workDir: defaultWorkDir(),
    skillsDir: join(opts.root, ".typer", "skills"),
    visionModel,
    distillModel,
    provider,
    providerId,
  };
}
