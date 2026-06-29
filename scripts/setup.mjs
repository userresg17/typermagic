#!/usr/bin/env node
// scripts/setup.mjs — instalador guiado do super-assistente (Telegram).
// Uso:  pnpm setup     (ou: node scripts/setup.mjs)
// Faz tudo: build → token do bot → descobre SEU id → escreve a config → (Linux) serviço 24/7.
// Pensado p/ quem clona do GitHub: um comando, sem decorar flags.

import { spawnSync } from "node:child_process";
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const HOME = homedir();
const ROOT = process.cwd();
const TYPER = join(HOME, ".typer");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const log = (s) => console.log(s);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", ...opts }).status === 0;

async function main() {
  log("\n🦞 TYPER Magic — instalador do super-assistente (Telegram)\n");

  // 1) Build
  log("1/5  Instalando dependências e compilando (pode demorar na 1ª vez)...");
  if (!run("pnpm", ["install"])) throw new Error("pnpm install falhou");
  if (!run("pnpm", ["-r", "build"])) throw new Error("build falhou");

  // 2) Navegador — Playwright como fallback; o bot auto-detecta Brave/Chrome instalado.
  log("\n2/5  Navegador (baixando o Chromium de fallback; o bot usa seu Brave/Chrome se houver)...");
  run("pnpm", ["-w", "exec", "playwright", "install", "chromium"]);

  // 3) Token do bot
  log("\n3/5  Token do bot:");
  log("     No Telegram, abra @BotFather → /newbot → copie o token que ele te dá.");
  const token = (process.env.TYPER_TELEGRAM_TOKEN || (await ask("     Cole o token aqui: "))).trim();
  if (!token) throw new Error("token vazio");
  await mkdir(TYPER, { recursive: true });
  await writeFile(join(TYPER, "gateway.env"), `TYPER_TELEGRAM_TOKEN=${token}\n`, { mode: 0o600 });
  await chmod(join(TYPER, "gateway.env"), 0o600);
  await writeFile(join(TYPER, "telegram.token"), token, { mode: 0o600 });
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
  if (!me?.ok) throw new Error("token inválido (getMe falhou)");
  log(`     ✓ Bot: @${me.result.username}`);

  // 4) Descobre seu id numérico (você manda uma mensagem; a gente lê)
  log(`\n4/5  Abra https://t.me/${me.result.username} , toque em Start e mande "oi".`);
  await ask('     Quando tiver mandado, aperte Enter aqui... ');
  const upd = await fetch(`https://api.telegram.org/bot${token}/getUpdates`).then((r) => r.json()).catch(() => null);
  const id = upd?.result?.map((u) => u.message?.from?.id).filter(Boolean).pop();
  if (!id) throw new Error('não recebi sua mensagem — mande "oi" pro bot e rode de novo');
  log(`     ✓ Seu id: ${id}`);

  // 5) Config (allowlist = só você; tools + memória + navegador + cofre ligados)
  const gw = {
    allow: [String(id)],
    rateCapacity: 5,
    rateRefillMs: 4000,
    features: { tools: true, memory: true },
    browser: { headless: true },
    vault: true,
    grants: { [String(id)]: { permissions: ["read", "meta", "network"], exec: ["in_process", "subprocess"] } },
  };
  await mkdir(join(ROOT, ".typer"), { recursive: true });
  await writeFile(join(ROOT, ".typer", "gateway.json"), JSON.stringify(gw, null, 2) + "\n");
  log("\n5/5  Config escrita em .typer/gateway.json ✓");

  // Serviço 24/7 (Linux/systemd)
  if (platform() === "linux") {
    const a = (await ask("\nInstalar como serviço 24/7 (systemd, recomendado)? [S/n] ")).trim().toLowerCase();
    if (a !== "n") {
      const unit = [
        "[Unit]",
        "Description=TYPER Magic — gateway Telegram (super-assistente)",
        "After=network-online.target",
        "Wants=network-online.target",
        "",
        "[Service]",
        "Type=simple",
        `WorkingDirectory=${ROOT}`,
        "EnvironmentFile=%h/.typer/gateway.env",
        "Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin",
        "ExecStart=/usr/bin/env node app/agent-cli/dist/main.js gateway telegram",
        "Restart=always",
        "RestartSec=5",
        "TimeoutStopSec=20",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n");
      await mkdir(join(HOME, ".config", "systemd", "user"), { recursive: true });
      await writeFile(join(HOME, ".config", "systemd", "user", "typermagic-gateway.service"), unit);
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "enable", "--now", "typermagic-gateway"]);
      run("loginctl", ["enable-linger", userInfo().username]);
      log("✓ Serviço no ar (24/7). Logs ao vivo: journalctl --user -u typermagic-gateway -f");
    }
  }

  log("\n✅ Pronto! Fale com seu bot no Telegram. Comece com /setup pra preencher seu perfil.");
  log("   Segurança e privacidade: veja SECURITY.md (nada vai pra servidor nosso).\n");
}

main()
  .catch((e) => {
    console.error(`\n✗ Setup interrompido: ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
