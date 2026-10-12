// app/agent-cli/src/meetings-setup.ts — monta a Central de Reuniões a partir do .env e do
// .typer/gateway.json, compartilhado pelo gateway (telegram/jarvis) e pelo comando `reunioes`
// (watch/sync/…), para as duas superfícies lerem a MESMA pasta com a MESMA configuração.
//
// Variáveis (todas no .env, fora do git):
//   TYPER_MEETINGS_DIR        pasta única (default ~/Reunioes)
//   TYPER_MEETINGS_MODEL      modelo p/ resumir/traduzir (default: modelo principal)
//   TYPER_DISCORD_TOKEN       token do bot (só leitura) — sem ele a fonte Discord fica desligada
//   TYPER_DISCORD_CHANNEL     nome do canal (default "transcrições")
//   TYPER_DISCORD_CHANNEL_ID  id do canal (opcional; pula a busca por nome)
//   TYPER_GOOGLE_CLIENT_FILE  JSON do OAuth client "Desktop app" (default ~/.typer/google-client.json)
//   TYPER_MEET_NAME_MATCH     termos no nome do doc do Gemini, separados por vírgula (default "Gemini")
//   TYPER_MEETINGS_POLL_SEC   intervalo do vigia (default 120)

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildProviders } from "@typer/router";
import { MeetingsHub, DiscordClient, DriveClient, GoogleAuth, loadClientFile, type Llm, type HubOptions } from "@typer/meetings";

const env = (k: string): string | undefined => (process.env[k]?.trim() ? process.env[k]!.trim() : undefined);
const expand = (p: string): string => p.replace(/^~(?=$|\/)/, homedir());

export function meetingsDir(): string {
  return expand(env("TYPER_MEETINGS_DIR") ?? "~/Reunioes");
}
export function googleClientFile(): string {
  return expand(env("TYPER_GOOGLE_CLIENT_FILE") ?? "~/.typer/google-client.json");
}
export function googleTokenFile(): string {
  return join(homedir(), ".typer", "google-token.json");
}
export function pollIntervalMs(): number {
  const s = Number(env("TYPER_MEETINGS_POLL_SEC") ?? 120);
  return Math.max(30, Number.isFinite(s) ? s : 120) * 1000;
}

export interface MeetingsSetup {
  hub: MeetingsHub;
  model: string;
  providerId: string;
  discord: boolean;
  drive: boolean;
  /** motivos de fonte desligada (p/ o status) */
  notes: string[];
}

/** LLM do typer (mesmo provider do gateway) como função system+user → texto. */
export async function buildMeetingsLlm(opts: { provider?: string | null | undefined; model?: string | null | undefined; local?: boolean | undefined }): Promise<{ llm: Llm; model: string; providerId: string }> {
  const built = await buildProviders(opts.local ?? false, opts.provider ?? null);
  const providerId = built.preferred;
  const provider = built.providers[providerId]!;
  if (providerId === "fake") throw new Error("sem provider de modelo configurado (defina TYPER_ANTHROPIC_KEY ou faça `typermagic login`)");
  const model = env("TYPER_MEETINGS_MODEL") ?? opts.model?.trim() ?? (providerId === "anthropic" ? "claude-opus-5-5" : "");
  if (!model) throw new Error("defina TYPER_MEETINGS_MODEL (ou TYPER_MODEL)");
  const llm: Llm = async (system, user) => {
    let out = "";
    for await (const c of provider.chat({ messages: [{ role: "user", content: user }], model, system, maxTokens: 16_000 })) out += c.text;
    return out;
  };
  return { llm, model, providerId };
}

/** Avisa o(s) dono(s) pelo Telegram direto pela Bot API (o watcher não tem o gateway). */
export function telegramNotifier(): ((text: string) => Promise<void>) | undefined {
  const token = env("TYPER_TELEGRAM_TOKEN");
  const ids = (env("TYPER_TELEGRAM_ALLOW") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!token || ids.length === 0) return undefined;
  return async (text) => {
    for (const chat_id of ids) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id, text: text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Telegram ${res.status}`);
    }
  };
}

export async function setupMeetings(opts: {
  provider?: string | null | undefined;
  model?: string | null | undefined;
  local?: boolean | undefined;
  /** avisar pelo Telegram quando uma reunião nova entrar (watcher: sim; gateway: não, responde no chat) */
  notify?: boolean;
  log?: (m: string) => void;
}): Promise<MeetingsSetup> {
  const { llm, model, providerId } = await buildMeetingsLlm(opts);
  const notes: string[] = [];
  const hubOpts: HubOptions = { dir: meetingsDir(), llm, ...(opts.log ? { log: opts.log } : {}) };
  if (opts.notify) {
    const n = telegramNotifier();
    if (n) hubOpts.notify = n;
    else notes.push("aviso no Telegram desligado (TYPER_TELEGRAM_TOKEN/ALLOW ausentes)");
  }
  const discordToken = env("TYPER_DISCORD_TOKEN");
  if (discordToken) {
    const channelId = env("TYPER_DISCORD_CHANNEL_ID");
    hubOpts.discord = { client: new DiscordClient(discordToken), channelName: env("TYPER_DISCORD_CHANNEL") ?? "transcrições", ...(channelId ? { channelId } : {}) };
  } else notes.push("Discord desligado: defina TYPER_DISCORD_TOKEN no .env (ver docs/CENTRAL-REUNIOES.md)");
  const clientFile = googleClientFile();
  if (existsSync(clientFile) && existsSync(googleTokenFile())) {
    const auth = new GoogleAuth(await loadClientFile(clientFile), googleTokenFile());
    const nameMatch = (env("TYPER_MEET_NAME_MATCH") ?? "Gemini").split(",").map((x) => x.trim()).filter(Boolean);
    hubOpts.drive = { client: new DriveClient(auth), nameMatch };
  } else notes.push(existsSync(clientFile) ? "Drive desligado: rode `typermagic reunioes google-auth`" : `Drive desligado: falta o client OAuth em ${clientFile} (ver docs/CENTRAL-REUNIOES.md)`);
  const hub = new MeetingsHub(hubOpts);
  await hub.store.init();
  return { hub, model, providerId, discord: Boolean(hubOpts.discord), drive: Boolean(hubOpts.drive), notes };
}
