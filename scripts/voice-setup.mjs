#!/usr/bin/env node
// scripts/voice-setup.mjs — instalador da VOZ (v2): comandos e respostas por áudio no Telegram.
// Uso:  pnpm voice:setup     (ou: node scripts/voice-setup.mjs)
// Baixa os modelos LOCAIS (ASR Whisper + TTS Piper pt_BR) p/ ~/.typer/voice, confere o ffmpeg e
// liga a voz no .typer/gateway.json. Tudo roda OFFLINE na sua máquina — áudio nunca sai daqui.
// Cross-platform: usa `tar -xf` (GNU tar no Linux/macOS; bsdtar embutido no Windows 10+).

import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline/promises";

const HOME = homedir();
const ROOT = process.cwd();
const VOICE = join(HOME, ".typer", "voice");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const log = (s) => console.log(s);

// Modelos oficiais do sherpa-onnx (k2-fsa) — CPU, offline, Apache-2.0.
const ASR = {
  name: "sherpa-onnx-whisper-base",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2",
  check: join(VOICE, "sherpa-onnx-whisper-base", "base-encoder.onnx"),
  size: "~250 MB",
};
const TTS = {
  name: "vits-piper-pt_BR-faber-medium",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-pt_BR-faber-medium.tar.bz2",
  check: join(
    VOICE,
    "vits-piper-pt_BR-faber-medium",
    "pt_BR-faber-medium.onnx",
  ),
  size: "~65 MB",
};

function haveFfmpeg() {
  try {
    return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function ffmpegHint() {
  const p = platform();
  if (p === "linux")
    return "     Instale: sudo apt install ffmpeg   (ou o equivalente da sua distro)";
  if (p === "win32")
    return "     Instale: winget install Gyan.FFmpeg   (ou baixe em https://ffmpeg.org/download.html e ponha no PATH)";
  if (p === "darwin") return "     Instale: brew install ffmpeg";
  return "     Instale o ffmpeg e garanta que ele está no PATH.";
}

/** Baixa (streaming, sem segurar tudo em RAM) e extrai um .tar.bz2 em ~/.typer/voice. */
async function fetchModel(m) {
  if (existsSync(m.check)) {
    log(`     ✓ ${m.name} já baixado.`);
    return;
  }
  const tarball = join(VOICE, `${m.name}.tar.bz2`);
  log(`     ↓ baixando ${m.name} (${m.size})...`);
  const res = await fetch(m.url, { redirect: "follow" });
  if (!res.ok || !res.body)
    throw new Error(`download falhou (${res.status}) — ${m.url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tarball));
  log(`     ⇩ extraindo ${m.name}...`);
  // -xf: GNU tar e bsdtar (Windows 10+) autodetectam o bzip2. -C aponta o destino.
  const ok =
    spawnSync("tar", ["-xf", tarball, "-C", VOICE], { stdio: "inherit" })
      .status === 0;
  await rm(tarball, { force: true });
  if (!ok || !existsSync(m.check))
    throw new Error(
      `extração falhou p/ ${m.name} (o 'tar' está disponível no PATH?)`,
    );
  log(`     ✓ ${m.name} pronto.`);
}

/** Liga voice.in/out no .typer/gateway.json do repo (se existir). */
async function enableInConfig() {
  const gwPath = join(ROOT, ".typer", "gateway.json");
  if (!existsSync(gwPath)) {
    log(
      "\n⚠️  Não achei .typer/gateway.json — rode `pnpm setup` primeiro. Depois é só:",
    );
    log(
      '     adicione  "voice": { "in": true, "out": true }  ao .typer/gateway.json',
    );
    return;
  }
  const a = (
    await ask("\nLigar voz (entrada + resposta) no gateway agora? [S/n] ")
  )
    .trim()
    .toLowerCase();
  if (a === "n") return;
  const cfg = JSON.parse(await readFile(gwPath, "utf8"));
  cfg.voice = { in: true, out: true };
  await writeFile(gwPath, JSON.stringify(cfg, null, 2) + "\n");
  log("     ✓ voice: { in: true, out: true } gravado em .typer/gateway.json");
  if (platform() === "linux") {
    log(
      "     Reinicie o serviço:  systemctl --user restart typermagic-gateway",
    );
  } else {
    log("     Reinicie o gateway p/ valer (feche e rode de novo).");
  }
}

async function main() {
  log(
    "\n🎙️  TYPER Magic — setup de VOZ (v2): ASR + TTS locais (offline, na sua máquina)\n",
  );

  log("1/4  ffmpeg (converte o áudio):");
  if (haveFfmpeg()) {
    log("     ✓ ffmpeg encontrado.");
  } else {
    log("     ✗ ffmpeg NÃO encontrado — é obrigatório.");
    log(ffmpegHint());
    throw new Error("instale o ffmpeg e rode de novo");
  }

  await mkdir(VOICE, { recursive: true });

  log("\n2/4  Modelo de reconhecimento (voz → texto):");
  await fetchModel(ASR);

  log("\n3/4  Modelo de fala (texto → voz, pt-BR):");
  await fetchModel(TTS);

  log("\n4/4  Ligar no gateway:");
  await enableInConfig();

  log(
    "\n✅ Voz pronta! Mande um ÁUDIO pro seu bot no Telegram — ele transcreve, executa e responde por voz.",
  );
  log("   Tudo local: nenhum áudio ou transcrição sai da sua máquina.\n");
}

main()
  .catch((e) => {
    console.error(`\n✗ Setup de voz interrompido: ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
