// app/agent-cli/src/commands/gateway.ts
// Sobe o gateway de mensagens. `gateway telegram` escuta o bot (BYO-token em
// TYPER_TELEGRAM_TOKEN). A allowlist de remetentes vem de .typer/gateway.json
// (default-deny: sem allowlist, ninguém é atendido). É bloqueante (long-polling).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Gateway, TelegramChannel, FakeChannel, type GatewayConfig, type ChannelAdapter } from "@typer/gateway";
import { rootOf, type Flags } from "../config.js";
import { dim, green, red } from "../render.js";

interface GatewayFile {
  allow?: string[];
  rateCapacity?: number;
  rateRefillMs?: number;
  /** recursos opt-in da Engine (ex.: { "tools": true } liga as ferramentas internas). */
  features?: GatewayConfig["features"];
  /** grant de capacidade por remetente (escala acima do READONLY da superfície). */
  grants?: GatewayConfig["grants"];
  /** liga o navegador real (Playwright) — ex.: { "headless": false } p/ relay de CAPTCHA. */
  browser?: GatewayConfig["browser"];
  /** liga o cofre cifrado (vault_fill) — abre ~/.typer/vault.enc sob demanda. */
  vault?: GatewayConfig["vault"];
}

async function loadGatewayFile(root: string): Promise<GatewayFile> {
  try {
    return JSON.parse(await readFile(join(root, ".typer", "gateway.json"), "utf8")) as GatewayFile;
  } catch {
    return {};
  }
}

export async function gatewayCmd(flags: Flags): Promise<number> {
  const channel = flags.rest[0] ?? "telegram";
  const root = rootOf();
  const file = await loadGatewayFile(root);
  const config: GatewayConfig = {
    root,
    allow: file.allow ?? [],
    provider: flags.provider,
    local: flags.local,
    ...(file.rateCapacity !== undefined ? { rateCapacity: file.rateCapacity } : {}),
    ...(file.rateRefillMs !== undefined ? { rateRefillMs: file.rateRefillMs } : {}),
    ...(file.features !== undefined ? { features: file.features } : {}),
    ...(file.grants !== undefined ? { grants: file.grants } : {}),
    ...(file.browser !== undefined ? { browser: file.browser } : {}),
    ...(file.vault !== undefined ? { vault: file.vault } : {}),
  };
  if (config.allow.length === 0) {
    console.error(dim("· aviso: allowlist vazia em .typer/gateway.json — ninguém será atendido (default-deny)"));
  }
  console.error(
    dim(
      `· config: features=${JSON.stringify(config.features ?? {})} grants=${config.grants ? Object.keys(config.grants).join(",") : "—"}`,
    ),
  );

  let adapter: ChannelAdapter;
  if (channel === "telegram") {
    const token = process.env.TYPER_TELEGRAM_TOKEN;
    if (!token) {
      console.error(red("Defina TYPER_TELEGRAM_TOKEN (token do @BotFather) para subir o canal Telegram."));
      return 2;
    }
    adapter = new TelegramChannel(token);
  } else if (channel === "fake") {
    adapter = new FakeChannel();
    console.error(dim("· canal fake não escuta nada (uso em teste)"));
  } else {
    console.error(red(`canal desconhecido: ${channel} (use: telegram | fake)`));
    return 2;
  }

  const gw = new Gateway(adapter, config, {
    onAudit: (e) => console.error(dim(`· [${e.sender}] ${e.result}${e.detail ? ` — ${e.detail}` : ""}`)),
  });
  console.error(
    green(`✓ gateway ${channel} no ar`) +
      dim(` — superfície gateway:${adapter.name}, ${config.allow.length} remetente(s) na allowlist`),
  );
  await gw.start(); // bloqueante (long-polling) p/ canais reais
  return 0;
}
