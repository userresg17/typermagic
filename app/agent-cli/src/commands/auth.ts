// app/agent-cli/src/commands/auth.ts
// BYOK: a chave nunca vai ao repo. `auth status` mostra quais providers têm chave
// (env ou keychain); `auth set <provider> [key]` grava no keychain do sistema (ou
// instrui a usar TYPER_<PROVIDER>_KEY quando o keychain não está disponível).

import { createInterface } from "node:readline/promises";
import { saveKey, hasKey } from "@typer/router";
import { type Flags } from "../config.js";
import { green, red, dim } from "../render.js";

const PROVIDERS = ["anthropic", "openai", "ollama"];

export async function authCmd(flags: Flags): Promise<number> {
  const [sub, provider, keyArg] = flags.rest;

  if (!sub || sub === "status") {
    for (const p of PROVIDERS) {
      console.log(`${(await hasKey(p)) ? green("✓") : dim("·")} ${p}`);
    }
    return 0;
  }

  if (sub === "set") {
    if (!provider) {
      console.error("uso: auth set <provider> [key]");
      return 2;
    }
    let key = keyArg;
    if (!key) {
      if (!process.stdin.isTTY) {
        console.error("forneça a chave: auth set <provider> <key>");
        return 2;
      }
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      key = (await rl.question(`Chave de ${provider}: `)).trim();
      rl.close();
    }
    if (!key) return 2;
    const ok = await saveKey(provider, key);
    console.log(
      ok
        ? green(`✓ chave de ${provider} salva no keychain`)
        : red(`keychain indisponível — exporte TYPER_${provider.toUpperCase()}_KEY`),
    );
    return ok ? 0 : 1;
  }

  console.error("uso: auth status | auth set <provider> [key]");
  return 2;
}
