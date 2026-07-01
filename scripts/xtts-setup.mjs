#!/usr/bin/env node
// scripts/xtts-setup.mjs — instala a voz NATURAL (XTTS-v2, Coqui) p/ a voz-OUT do Telegram.
// Uso:  pnpm xtts:setup     (ou: node scripts/xtts-setup.mjs)
// Cria um venv em ~/.typer/voice/xtts-venv e instala torch(CPU)+coqui-tts. O modelo (~2GB) baixa
// sozinho no 1º uso. Roda 100% LOCAL (CPU, lento porém natural — pt-BR de verdade + inglês nativo).
// Licença do modelo XTTS-v2: Coqui Public Model License (CPML) — uso não-comercial.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const HOME = homedir();
const ROOT = process.cwd();
const VENV = join(HOME, ".typer", "voice", "xtts-venv");
const PY = join(VENV, "bin", platform() === "win32" ? "python.exe" : "python");
const PIP = [PY, "-m", "pip"];
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const log = (s) => console.log(s);
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" }).status === 0;

function findPython() {
  for (const p of ["python3.11", "python3.12", "python3.10", "python3"]) {
    const r = spawnSync(p, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return p;
  }
  return null;
}

async function main() {
  log("\n🗣️  TYPER Magic — setup da voz NATURAL (XTTS-v2, local em CPU)\n");

  if (!run("ffmpeg", ["-version"])) {
    log("✗ ffmpeg é obrigatório. Instale-o e rode de novo (Linux: sudo apt install ffmpeg).");
    throw new Error("sem ffmpeg");
  }

  const py = findPython();
  if (!py) throw new Error("Python 3 não encontrado — instale o Python 3.10–3.12.");
  log(`1/4  Python: ${py} (${spawnSync(py, ["--version"]).stdout?.toString().trim() || "ok"})`);

  if (!existsSync(PY)) {
    log("2/4  Criando venv em ~/.typer/voice/xtts-venv …");
    if (!run(py, ["-m", "venv", VENV])) throw new Error("falha ao criar o venv");
  } else {
    log("2/4  venv já existe ✓");
  }
  run(...[PIP[0], [...PIP.slice(1), "install", "-q", "-U", "pip"]]);

  log("3/4  Instalando torch (CPU) + coqui-tts … (grande — vários minutos na 1ª vez)");
  const cpu = ["--index-url", "https://download.pytorch.org/whl/cpu"];
  if (!run(PY, ["-m", "pip", "install", "-q", "torch", "torchaudio", ...cpu])) throw new Error("falha no torch");
  if (!run(PY, ["-m", "pip", "install", "-q", "coqui-tts[codec]"])) throw new Error("falha no coqui-tts");
  // coqui-tts puxa transformers 5.x, mas o código quebra nela (isin_mps_friendly) — fixa a 4.x.
  if (!run(PY, ["-m", "pip", "install", "-q", "transformers<5"])) throw new Error("falha ao fixar transformers");

  log("     Validando import…");
  const ok = spawnSync(PY, ["-c", "from TTS.api import TTS; print('ok')"], { encoding: "utf8" });
  if (!/ok/.test(ok.stdout || "")) {
    log(ok.stderr?.slice(-600) || "");
    throw new Error("o TTS não importou — veja o erro acima");
  }
  log("     ✓ XTTS pronto (o modelo ~2GB baixa sozinho no 1º áudio).");

  log("\n4/4  Ligar no gateway:");
  const gwPath = join(ROOT, ".typer", "gateway.json");
  if (existsSync(gwPath)) {
    const a = (await ask('Ligar a voz XTTS agora (voice.engine="xtts")? [S/n] ')).trim().toLowerCase();
    if (a !== "n") {
      const cfg = JSON.parse(await readFile(gwPath, "utf8"));
      cfg.voice = { ...(cfg.voice || {}), in: true, out: true, engine: "xtts" };
      await writeFile(gwPath, JSON.stringify(cfg, null, 2) + "\n");
      log('     ✓ voice.engine="xtts" gravado.');
      if (platform() === "linux") log("     Reinicie:  systemctl --user restart typermagic-gateway");
    }
  } else {
    log('     Rode `pnpm setup` primeiro; depois ponha  "voice": { "in": true, "out": true, "engine": "xtts" }.');
  }

  log("\n✅ Voz natural pronta! Mande um áudio — a 1ª resposta demora mais (baixa o modelo), as seguintes menos.");
  log("   Tudo local: nenhum áudio ou texto sai da sua máquina.\n");
}

main()
  .catch((e) => {
    console.error(`\n✗ Setup XTTS interrompido: ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
