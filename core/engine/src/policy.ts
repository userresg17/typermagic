// core/engine/policy.ts
// O selo generalizado para EFEITO EXTERNO. Toda ação que muta algo fora do
// workspace (rede, histórico git, processo) passa por aqui ANTES de executar. A
// regra dura que mata o caso MoltMatch: uma superfície AUTÔNOMA (scheduler/gateway
// com approval "never") NUNCA executa uma ação irreversível sozinha. Ação reversível
// fora da política também escala (interativo) ou é negada (autônomo). A política
// (allowlist de hosts/comandos) vive em .typer/policy.json — default-deny no que
// importa, permissivo só onde o broker já restringe.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExternalEffect } from "@typer/agent";
import type { SurfaceId } from "./types.js";

export interface Policy {
  /** rede: hosts permitidos (ausente = sem allowlist, qualquer host reversível) */
  network?: { allowHosts?: string[] };
  /** exec: binários/comandos permitidos (ausente = sem allowlist) */
  exec?: { allowCommands?: string[] };
}

export type PolicyDecision =
  | { decision: "allow"; preview?: string }
  | { decision: "approve"; reason: string; preview?: string }
  | { decision: "deny"; reason: string };

/** Lê .typer/policy.json (ou {} se não existe/inválido). */
export async function loadPolicy(root: string): Promise<Policy> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(root, ".typer", "policy.json"), "utf8"));
    return (raw && typeof raw === "object" ? raw : {}) as Policy;
  } catch {
    return {};
  }
}

/** Superfície sem humano para aprovar (autonomia) — onde a regra dura morde. */
export function isAutonomous(surface: SurfaceId, approval: string): boolean {
  if (approval !== "never") return false;
  return surface === "scheduler" || surface.startsWith("gateway:");
}

function hostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function firstWord(cmd: unknown): string | null {
  if (typeof cmd !== "string") return null;
  const m = cmd.trim().match(/^\S+/);
  return m ? m[0] : null;
}

/** Avalia uma ação de efeito externo contra a política e a autonomia da superfície. */
export function evaluateExternal(opts: {
  toolName: string;
  effect: ExternalEffect;
  args: Record<string, unknown>;
  autonomous: boolean;
  policy: Policy;
}): PolicyDecision {
  const { effect, args, autonomous, policy, toolName } = opts;

  // preview legível + checagem de allowlist por tipo
  let preview = toolName;
  let inPolicy = true;
  let policyReason = "";
  if (effect.kind === "network") {
    const host = hostOf(args.url);
    preview = host ? `${toolName} → ${host}` : `${toolName} (rede)`;
    if (policy.network?.allowHosts && host && !policy.network.allowHosts.includes(host)) {
      inPolicy = false;
      policyReason = `host "${host}" fora da allowlist de rede`;
    }
  } else if (effect.kind === "exec") {
    const bin = firstWord(args.cmd);
    preview = bin ? `${toolName}: ${bin}` : `${toolName} (exec)`;
    if (policy.exec?.allowCommands && bin && !policy.exec.allowCommands.includes(bin)) {
      inPolicy = false;
      policyReason = `comando "${bin}" fora da allowlist de exec`;
    }
  }

  // irreversível: superfície autônoma NUNCA executa sozinha (a regra dura).
  if (!effect.reversible) {
    if (autonomous) {
      return { decision: "deny", reason: `ação irreversível (${toolName}) negada em superfície autônoma — exige selo humano` };
    }
    return { decision: "approve", reason: `ação irreversível: ${toolName}`, preview };
  }

  // reversível fora de política: autônomo nega, interativo pede aprovação.
  if (!inPolicy) {
    if (autonomous) return { decision: "deny", reason: policyReason };
    return { decision: "approve", reason: policyReason, preview };
  }

  // reversível dentro de política: passa, com preview do que vai acontecer.
  return { decision: "allow", preview };
}
