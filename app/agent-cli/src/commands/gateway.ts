// app/agent-cli/src/commands/gateway.ts
// Sobe o gateway de mensagens. `gateway telegram` escuta o bot (BYO-token em
// TYPER_TELEGRAM_TOKEN). A allowlist de remetentes vem de .typer/gateway.json
// (default-deny: sem allowlist, ninguém é atendido). É bloqueante (long-polling).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { Gateway, TelegramChannel, FakeChannel, JarvisChannel, type GatewayConfig, type ChannelAdapter, type GatewayHooks } from "@typer/gateway";
import { openCdpBrowser, pickPlatform, BROWSER_AGENT_PROMPT_MACOS } from "@typer/agent";
import { transcribe, asrReady, synthesize, synthesizeToWav, speechify, splitSentences, ttsReady, xttsWorkerPath, mlxWorkerPath, type AsrModel, type TtsModel } from "@typer/voice";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rootOf, type Flags } from "../config.js";
import { dim, green, red, yellow } from "../render.js";

interface GatewayFile {
  allow?: string[];
  /** provider do modelo (ex.: "claude-cli" p/ usar o Claude Code logado, "openai", "anthropic"). */
  provider?: string | null;
  /** voz (v2): { in:true } aceita áudio (transcreve local), { out:true } responde por voz.
   *  speed<1 fala mais devagar (default 0.9). engine: "piper" (rápido, sherpa), "kokoro"
   *  (sem pt — evitar) ou "xtts" (Coqui: pt-BR natural + inglês nativo, lento na CPU).
   *  sid: voz do Kokoro; speaker: locutor do XTTS. */
  voice?: {
    in?: boolean;
    out?: boolean;
    speed?: number;
    engine?: "piper" | "kokoro" | "xtts" | "mlx";
    /** mlx: repo HF do modelo (default Kokoro-82M); voz em `speaker` (pf_dora); idioma em `lang` */
    model?: string;
    lang?: string;
    sid?: number;
    speaker?: string;
  };
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
  /** macOS: liga o controle de DESKTOP (sidecar pyobjc) p/ as ferramentas desktop_*. */
  desktop?: boolean;
  /** override de modelo (ex.: "claude-opus-5-5"). Também via TYPER_MODEL. */
  model?: string | null;
  checkpointEvery?: number;
}

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

async function loadGatewayFile(root: string): Promise<GatewayFile> {
  try {
    return JSON.parse(await readFile(join(root, ".typer", "gateway.json"), "utf8")) as GatewayFile;
  } catch {
    return {};
  }
}

/** monta o modelo de TTS a partir do gateway.json (mesma voz no Telegram e no Jarvis). */
function buildTts(file: GatewayFile): { tts: TtsModel; engine: string } {
  const vdir = join(homedir(), ".typer", "voice");
  const engine = file.voice?.engine ?? "piper";
  let tts: TtsModel;
  if (engine === "mlx") {
    tts = {
      engine: "mlx",
      model: file.voice?.model ?? "mlx-community/Kokoro-82M-bf16",
      tokens: "",
      python: join(vdir, "mlx-venv", "bin", "python"),
      worker: mlxWorkerPath,
      language: file.voice?.lang ?? "p",
      speaker: file.voice?.speaker ?? "pf_dora",
      speed: file.voice?.speed ?? 1.1,
    };
  } else if (engine === "xtts") {
    tts = {
      engine: "xtts",
      model: "", // baixa o xtts_v2 sozinho no 1º uso
      tokens: "",
      python: join(vdir, "xtts-venv", "bin", "python"),
      worker: xttsWorkerPath,
      language: "pt",
      speed: file.voice?.speed ?? 1.1, // 10% mais rápido por padrão
      ...(file.voice?.speaker ? { speaker: file.voice.speaker } : {}),
    };
  } else if (engine === "kokoro") {
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
  return { tts, engine };
}

export async function gatewayCmd(flags: Flags): Promise<number> {
  const channel = flags.rest[0] ?? "telegram";
  const root = rootOf();
  const file = await loadGatewayFile(root);
  // macOS: navegador real via CDP (perfil dedicado, sem stealth) + prompt sem anti-bot; desktop opt-in.
  const mac = process.platform === "darwin";
  const wantBrowser = file.browser !== undefined;
  const config: GatewayConfig = {
    root,
    // allowlist: gateway.json OU TYPER_TELEGRAM_ALLOW do .env (macOS: tudo num lugar só)
    allow: file.allow?.length ? file.allow : list(process.env.TYPER_TELEGRAM_ALLOW),
    provider: flags.provider ?? file.provider ?? process.env.TYPER_PROVIDER ?? null,
    model: flags.model ?? file.model ?? process.env.TYPER_MODEL ?? null,
    ...(mac && wantBrowser && !file.browser?.cdpUrl
      ? { openBrowser: () => openCdpBrowser(), browserPrompt: BROWSER_AGENT_PROMPT_MACOS }
      : {}),
    ...(mac && file.desktop ? { openDesktop: () => pickPlatform() } : {}),
    ...(file.checkpointEvery !== undefined ? { checkpointEvery: file.checkpointEvery } : {}),
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
      `· config: features=${JSON.stringify(config.features ?? {})} grants=${config.grants ? Object.keys(config.grants).join(",") : "—"} browser=${config.browser || config.openBrowser ? (config.openBrowser ? "cdp-macos" : "on") : "off"} desktop=${config.openDesktop ? "on" : "off"} vault=${config.vault ? "on" : "off"} model=${config.model ?? "default"}`,
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
      const { tts, engine } = buildTts(file);
      if (ttsReady(tts)) {
        let n = 0;
        synthesizeVoice = async (text) => {
          const out = join(tmpdir(), `typer-voiceout-${process.pid}-${n++}.ogg`);
          await synthesize(text, out, tts);
          return out;
        };
        const label = engine === "mlx" ? `mlx na GPU (${tts.model})` : engine === "xtts" ? "xtts pt-BR (natural, lento)" : engine === "kokoro" ? "kokoro multilíngue" : "piper pt_BR";
        console.error(dim(`· voz-OUT ligada (TTS local: ${label})`));
      } else {
        console.error(yellow(`· voz-OUT pedida (${engine}), mas o modelo não está em ~/.typer/voice — rode o setup de voz`));
      }
    }
    adapter = new TelegramChannel(token, voiceHook);
  } else if (channel === "jarvis") {
    // Conversa por VOZ no Mac: ouvido local (jarvis_ear.py) + mesmo agente + fala frase a frase.
    // Remetente "jarvis" herda o grant do dono (1º da allowlist do Telegram).
    const owner = config.allow[0];
    config.allow = ["jarvis"];
    if (owner && config.grants?.[owner]) config.grants = { jarvis: config.grants[owner]! };
    const vdir = join(homedir(), ".typer", "voice");
    const python = join(vdir, "jarvis-venv", "bin", "python");
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    const earScript = join(process.env.TYPER_ROOT ?? repoRoot, "platform", "voice", "jarvis_ear.py");
    if (!existsSync(python) || !existsSync(earScript)) {
      console.error(red(`Jarvis: falta o ouvido (${existsSync(python) ? earScript : python}). Rode scripts/install_jarvis.sh`));
      return 2;
    }
    const { tts, engine } = buildTts(file);
    if (!ttsReady(tts)) {
      console.error(red(`Jarvis: voz (${engine}) não está instalada em ~/.typer/voice`));
      return 2;
    }
    const token = process.env.TYPER_TELEGRAM_TOKEN;
    const tg = token && owner ? { token, chat: owner } : null;
    const tgCall = async (method: string, body: FormData | Record<string, unknown>): Promise<void> => {
      if (!tg) return;
      const init: RequestInit = body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      await fetch(`https://api.telegram.org/bot${tg.token}/${method}`, { ...init, signal: AbortSignal.timeout(20000) });
    };
    const respell = engine !== "xtts" && engine !== "kokoro" && engine !== "mlx";
    const hudScript = join(process.env.TYPER_ROOT ?? repoRoot, "platform", "voice", "jarvis_hud.py");
    const hudPython = join(process.env.TYPER_ROOT ?? repoRoot, ".venv", "bin", "python");
    adapter = new JarvisChannel({
      python,
      earScript,
      ...(existsSync(hudScript) && existsSync(hudPython) ? { hud: { python: hudPython, script: hudScript } } : {}),
      synthToWav: (text, wav) => synthesizeToWav(text, wav, tts),
      prepare: (t) => speechify(t, respell),
      split: (t) => splitSentences(t),
      ...(tg
        ? {
            mirror: {
              text: (t) => tgCall("sendMessage", { chat_id: tg.chat, text: t.slice(0, 4000), disable_web_page_preview: true }),
              photo: (png, caption) => {
                const fd = new FormData();
                fd.set("chat_id", tg.chat);
                if (caption) fd.set("caption", caption.slice(0, 1000));
                fd.set("photo", new Blob([new Uint8Array(Buffer.from(png, "base64"))], { type: "image/png" }), "tela.png");
                return tgCall("sendPhoto", fd);
              },
            },
          }
        : {}),
      earEnv: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("JARVIS_")).map(([k, v]) => [k, v ?? ""])),
      log: (m) => console.error(dim(`· ${m}`)),
    });
    console.error(dim(`· Jarvis: voz ${engine}${tg ? ", espelho no Telegram ligado" : ""}`));
  } else if (channel === "fake") {
    adapter = new FakeChannel();
    console.error(dim("· canal fake não escuta nada (uso em teste)"));
  } else {
    console.error(red(`canal desconhecido: ${channel} (use: telegram | jarvis | fake)`));
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
