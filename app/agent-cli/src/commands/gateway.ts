// app/agent-cli/src/commands/gateway.ts
// Sobe o gateway de mensagens. `gateway telegram` escuta o bot (BYO-token em
// TYPER_TELEGRAM_TOKEN). A allowlist de remetentes vem de .typer/gateway.json
// (default-deny: sem allowlist, ninguém é atendido). É bloqueante (long-polling).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { Gateway, TelegramChannel, FakeChannel, type GatewayConfig, type ChannelAdapter, type GatewayHooks } from "@typer/gateway";
import { transcribe, asrReady, synthesize, ttsReady, type AsrModel, type TtsModel } from "@typer/voice";
import { rootOf, type Flags } from "../config.js";
import { dim, green, red, yellow } from "../render.js";

interface GatewayFile {
  allow?: string[];
  /** provider do modelo (ex.: "claude-cli" p/ usar o Claude Code logado, "openai", "anthropic"). */
  provider?: string | null;
  /** voz (v2): { in:true } aceita áudio (transcreve local), { out:true } responde por voz.
   *  speed<1 fala mais devagar (default 0.9). engine: "piper" (default, RÁPIDO) ou "kokoro"
   *  (multilíngue, pronuncia inglês nativo, mas ~12x mais lento na CPU — resposta demora ~25s). */
  voice?: { in?: boolean; out?: boolean; speed?: number; engine?: "piper" | "kokoro"; sid?: number };
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
    provider: flags.provider ?? file.provider ?? null,
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
      `· config: features=${JSON.stringify(config.features ?? {})} grants=${config.grants ? Object.keys(config.grants).join(",") : "—"} browser=${config.browser ? "on" : "off"} vault=${config.vault ? "on" : "off"}`,
    ),
  );

  let adapter: ChannelAdapter;
  // voz-OUT (opt-in): sintetiza a resposta em áudio. Construída no branch do Telegram.
  let synthesizeVoice: ((text: string) => Promise<string>) | undefined;
  if (channel === "telegram") {
    const token = process.env.TYPER_TELEGRAM_TOKEN;
    if (!token) {
      console.error(red("Defina TYPER_TELEGRAM_TOKEN (token do @BotFather) para subir o canal Telegram."));
      return 2;
    }
    // VOZ-IN (opt-in): monta a transcrição LOCAL (@typer/voice) se o modelo Whisper estiver baixado.
    let voiceHook: { transcribe: (p: string) => Promise<string> } | undefined;
    if (file.voice?.in) {
      const dir = join(homedir(), ".typer", "voice", "sherpa-onnx-whisper-base");
      const model: AsrModel = {
        encoder: join(dir, "base-encoder.onnx"),
        decoder: join(dir, "base-decoder.onnx"),
        tokens: join(dir, "base-tokens.txt"),
        language: "pt",
      };
      if (asrReady(model)) {
        voiceHook = { transcribe: (p) => transcribe(p, model) };
        console.error(dim("· voz-IN ligada (ASR local: whisper-base, pt)"));
      } else {
        console.error(yellow("· voz-IN pedida, mas o modelo ASR não está em ~/.typer/voice — rode o setup de voz"));
      }
    }
    // VOZ-OUT (opt-in): monta a síntese LOCAL (@typer/voice). Engine "piper" (default, rápido) ou
    // "kokoro" (multilíngue, inglês nativo, porém ~12x mais lento na CPU).
    if (file.voice?.out) {
      const vdir = join(homedir(), ".typer", "voice");
      const engine = file.voice?.engine ?? "piper";
      let tts: TtsModel;
      if (engine === "kokoro") {
        const k = join(vdir, "kokoro-int8-multi-lang-v1_0");
        tts = {
          engine: "kokoro",
          model: join(k, "model.int8.onnx"),
          tokens: join(k, "tokens.txt"),
          voices: join(k, "voices.bin"),
          dataDir: join(k, "espeak-ng-data"),
          dictDir: join(k, "dict"),
          lexicon: `${join(k, "lexicon-us-en.txt")},${join(k, "lexicon-zh.txt")}`,
          sid: file.voice?.sid ?? 44, // pt-BR (pm_alex)
          speed: file.voice?.speed ?? 1.0,
          numThreads: 4,
        };
      } else {
        const p = join(vdir, "vits-piper-pt_BR-faber-medium");
        tts = {
          engine: "piper",
          model: join(p, "pt_BR-faber-medium.onnx"),
          tokens: join(p, "tokens.txt"),
          dataDir: join(p, "espeak-ng-data"),
          speed: file.voice?.speed ?? 0.9, // fala 10% mais devagar por padrão
        };
      }
      if (ttsReady(tts)) {
        let n = 0;
        synthesizeVoice = async (text) => {
          const out = join(tmpdir(), `typer-voiceout-${process.pid}-${n++}.ogg`);
          await synthesize(text, out, tts);
          return out;
        };
        console.error(dim(`· voz-OUT ligada (TTS local: ${engine === "kokoro" ? "kokoro multilíngue" : "piper pt_BR"})`));
      } else {
        console.error(yellow(`· voz-OUT pedida (${engine}), mas o modelo não está em ~/.typer/voice — rode o setup de voz`));
      }
    }
    adapter = new TelegramChannel(token, voiceHook);
  } else if (channel === "fake") {
    adapter = new FakeChannel();
    console.error(dim("· canal fake não escuta nada (uso em teste)"));
  } else {
    console.error(red(`canal desconhecido: ${channel} (use: telegram | fake)`));
    return 2;
  }

  const hooks: GatewayHooks = {
    onAudit: (e) => console.error(dim(`· [${e.sender}] ${e.result}${e.detail ? ` — ${e.detail}` : ""}`)),
    ...(synthesizeVoice ? { synthesizeVoice } : {}),
  };
  const gw = new Gateway(adapter, config, hooks);
  console.error(
    green(`✓ gateway ${channel} no ar`) +
      dim(` — superfície gateway:${adapter.name}, ${config.allow.length} remetente(s) na allowlist`),
  );
  await gw.start(); // bloqueante (long-polling) p/ canais reais
  return 0;
}
