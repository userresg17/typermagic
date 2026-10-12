// app/agent-cli/src/commands/reunioes.ts — Central de Reuniões no terminal e como serviço.
//   reunioes watch           vigia Discord + Drive em loop (é o que o LaunchAgent roda)
//   reunioes sync            uma rodada agora
//   reunioes google-auth     autoriza o Google Drive (só leitura) UMA vez, no navegador
//   reunioes discord-check   mostra servidores/canais que o bot enxerga e se lê conteúdo
//   reunioes drive-check     lista os docs do Drive que o filtro pega (sem ingerir)
//   reunioes importar <arq>  ingere um arquivo de texto local (--plataforma discord|meet|whatsapp|arquivo)
//   reunioes list [n] · status · buscar <consulta>

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import { GoogleAuth, loadClientFile, loginInteractive, DiscordClient, DriveClient, type Platform } from "@typer/meetings";
import { setupMeetings, googleClientFile, googleTokenFile, meetingsDir, pollIntervalMs } from "../meetings-setup.js";
import type { Flags } from "../config.js";
import { dim, bold, green, red, yellow } from "../render.js";

const env = (k: string): string | undefined => (process.env[k]?.trim() ? process.env[k]!.trim() : undefined);
const log = (m: string): void => console.error(dim(`· ${new Date().toISOString().slice(11, 19)} ${m}`));

export async function reunioesCmd(flags: Flags): Promise<number> {
  const [sub, ...rest] = flags.rest;
  if (!sub || sub === "help") {
    console.log(
      [
        bold("reunioes") + " — Central de Reuniões (Discord · Google Meet/Gemini · WhatsApp via Telegram)",
        "  reunioes watch              vigia as fontes em loop (serviço: scripts/install_reunioes.sh)",
        "  reunioes sync               puxa Discord e Drive uma vez",
        "  reunioes google-auth        autoriza o Google Drive (só leitura) no navegador",
        "  reunioes discord-check      o que o bot do Discord enxerga (servidores, canal, conteúdo)",
        "  reunioes drive-check        quais docs do Drive o filtro pega (TYPER_MEET_NAME_MATCH)",
        "  reunioes importar <arquivo> [--plataforma whatsapp|discord|meet|arquivo] [--titulo \"…\"]",
        "  reunioes list [n] · status · buscar <consulta>",
        dim(`  pasta: ${meetingsDir()} · índice: REUNIOES.md · env: TYPER_MEETINGS_* / TYPER_DISCORD_* / TYPER_GOOGLE_CLIENT_FILE`),
      ].join("\n"),
    );
    return 0;
  }

  if (sub === "google-auth") {
    const clientFile = googleClientFile();
    if (!existsSync(clientFile)) {
      console.error(red(`falta o JSON do OAuth client em ${clientFile}`));
      console.error("Crie em console.cloud.google.com → APIs e serviços → Credenciais → ID do cliente OAuth → tipo 'App para computador', baixe o JSON e salve nesse caminho (passo a passo em docs/CENTRAL-REUNIOES.md).");
      return 2;
    }
    const auth = new GoogleAuth(await loadClientFile(clientFile), googleTokenFile());
    await loginInteractive(auth, {
      log: (m) => console.error(m),
      open: (url) => {
        if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
      },
    });
    console.log(green(`✓ Google Drive autorizado. Token em ${googleTokenFile()} (600).`));
    return 0;
  }

  if (sub === "discord-check") {
    const token = env("TYPER_DISCORD_TOKEN");
    if (!token) {
      console.error(red("TYPER_DISCORD_TOKEN não definido no .env"));
      return 2;
    }
    const c = new DiscordClient(token);
    const me = await c.me();
    console.log(`bot: ${me.username} (${me.id})`);
    const guilds = await c.guilds();
    if (guilds.length === 0) {
      console.log(yellow("o bot não está em nenhum servidor — convide pelo link OAuth2 (docs/CENTRAL-REUNIOES.md)"));
      return 1;
    }
    const want = env("TYPER_DISCORD_CHANNEL") ?? "transcrições";
    for (const g of guilds) {
      const chans = await c.channels(g.id);
      console.log(`servidor: ${g.name} (${g.id}) — ${chans.filter((x) => x.type === 0).length} canal(is) de texto`);
      for (const ch of chans.filter((x) => x.type === 0)) console.log(`  #${ch.name} (${ch.id})`);
    }
    const found = await c.findChannel(want);
    if (!found) {
      console.log(red(`canal #${want} não encontrado (ajuste TYPER_DISCORD_CHANNEL ou confira se o bot vê o canal)`));
      return 1;
    }
    const msgs = await c.messagesAfter(found.channel.id, null, 100);
    const last = msgs.slice(-3);
    console.log(green(`✓ #${found.channel.name} = ${found.channel.id} · ${msgs.length} mensagem(ns) lidas (até 100)`));
    for (const m of last) console.log(`  ${m.timestamp.slice(0, 16)} ${m.author.username}: ${m.content ? JSON.stringify(m.content.slice(0, 80)) : "(sem conteúdo)"}${m.attachments?.length ? ` +${m.attachments.length} anexo(s)` : ""}`);
    if (msgs.length && msgs.every((m) => !m.content && !m.attachments?.length)) {
      console.log(red("✗ conteúdo vazio: ative 'Message Content Intent' em Developer Portal → Bot → Privileged Gateway Intents"));
      return 1;
    }
    return 0;
  }

  if (sub === "drive-check") {
    const clientFile = googleClientFile();
    if (!existsSync(clientFile) || !existsSync(googleTokenFile())) {
      console.error(red("Drive não autorizado — rode: typermagic reunioes google-auth"));
      return 2;
    }
    const auth = new GoogleAuth(await loadClientFile(clientFile), googleTokenFile());
    const drive = new DriveClient(auth);
    const nameMatch = (env("TYPER_MEET_NAME_MATCH") ?? "Gemini").split(",").map((x) => x.trim()).filter(Boolean);
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const files = await drive.listNotes({ nameMatch, since });
    console.log(`filtro: nome contém ${nameMatch.map((n) => `"${n}"`).join(" ou ")} · últimos 60 dias · ${files.length} doc(s)`);
    for (const f of files.slice(-20)) console.log(`  ${f.createdTime.slice(0, 16)} ${f.name} (${f.id})`);
    if (files.length === 0) console.log(yellow("nenhum doc casou — abra o Drive, veja como o Gemini nomeia as notas e ajuste TYPER_MEET_NAME_MATCH"));
    return 0;
  }

  // daqui p/ baixo precisa do hub completo (modelo + fontes)
  const setup = await setupMeetings({ provider: flags.provider, model: flags.model, local: flags.local, notify: sub === "watch" || sub === "sync", log });
  const { hub } = setup;
  for (const n of setup.notes) console.error(yellow(`· ${n}`));

  if (sub === "watch") {
    console.error(green(`✓ Central de Reuniões vigiando`) + dim(` — pasta ${hub.dir} · modelo ${setup.model} · Discord ${setup.discord ? "on" : "off"} · Drive ${setup.drive ? "on" : "off"} · a cada ${pollIntervalMs() / 1000}s`));
    const ac = new AbortController();
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ac.abort());
    await hub.watch(pollIntervalMs(), ac.signal);
    return 0;
  }
  if (sub === "sync") {
    const r = await hub.pollOnce();
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  if (sub === "status") {
    const st = await hub.state();
    const all = await hub.list();
    console.log(`pasta: ${hub.dir} · ${all.length} reunião(ões) · modelo ${setup.model} (${setup.providerId})`);
    console.log(`discord: ${setup.discord ? JSON.stringify(st.discord ?? {}) : "off"}`);
    console.log(`drive: ${setup.drive ? JSON.stringify(st.drive ?? {}) : "off"}`);
    return 0;
  }
  if (sub === "list") {
    const n = Math.max(1, Number(rest[0]) || 20);
    const all = (await hub.list()).slice(0, n);
    if (all.length === 0) console.log(dim("· nenhuma reunião ainda"));
    for (const m of all) console.log(`• ${m.date.slice(0, 16)} [${m.platform}] ${m.summary.titulo} — ${m.summary.participantes.join(", ") || "—"} · ${basename(m.file)}`);
    return 0;
  }
  if (sub === "buscar") {
    const q = rest.join(" ").trim();
    const hits = await hub.search(q, { k: 8 });
    if (hits.length === 0) console.log(dim("· nada encontrado"));
    for (const h of hits) console.log(`• [${h.score}] ${h.meeting.date.slice(0, 10)} ${h.meeting.summary.titulo}\n   ${h.snippet.slice(0, 200)}`);
    return 0;
  }
  if (sub === "importar") {
    const file = rest[0];
    if (!file) {
      console.error("uso: reunioes importar <arquivo.txt> [--plataforma whatsapp|discord|meet|arquivo] [--titulo \"…\"]");
      return 2;
    }
    const text = await readFile(file, "utf8");
    const platform = (["discord", "meet", "whatsapp", "arquivo"].includes(flags.plataforma ?? "") ? flags.plataforma : "arquivo") as Platform;
    const r = await hub.ingestText(text, { platform, ...(flags.titulo ? { title: flags.titulo } : {}), origin: `arquivo local ${basename(file)}` });
    console.log(r.duplicate ? yellow(`já estava na central: ${r.meeting.id}`) : green(`✓ ${r.meeting.file}`));
    if (!r.duplicate) console.log(r.message);
    return 0;
  }
  console.error(red(`subcomando desconhecido: ${sub}`));
  return 2;
}
