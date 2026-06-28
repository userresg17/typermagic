// app/agent-cli/src/commands/auth.ts
// Autenticação por provider. Três caminhos:
//   auth set <provider> [key]   → BYOK: grava a API key no keychain (ou instrui o env).
//   auth login <provider>       → "entrar com a assinatura" (OAuth+PKCE, estilo Claude
//                                 Code / Codex). Mostra o aviso de termos antes de abrir o
//                                 navegador. Consome a assinatura do dono — zona cinzenta.
//   auth logout <provider>      → apaga o login OAuth.
//   auth status                 → o que cada provider tem (key / login / nada).

import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import {
  saveKey,
  resolveAuth,
  PROVIDERS,
  generatePkce,
  randomState,
  buildAuthorizeUrl,
  exchangeCode,
  waitForLoopbackCallback,
  saveOAuth,
  clearOAuth,
} from "@typer/router";
import { type Flags } from "../config.js";
import { green, red, dim, bold, yellow } from "../render.js";

const PROVIDERS_LIST = ["anthropic", "openai", "ollama"];

/** Abre a URL no navegador padrão (best-effort; em headless só imprime). */
function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* sem navegador: o usuário abre a URL manualmente */
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer;
}

/** Fluxo "entrar com a assinatura". */
async function login(provider: string): Promise<number> {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    console.error(red(`login OAuth não disponível p/ "${provider}". Tente: auth set ${provider} <key>`));
    return 2;
  }

  // Aviso honesto antes de qualquer coisa (a marca é confiança).
  console.error(bold(`\nEntrar com sua assinatura ${cfg.label} (OAuth)`));
  console.error(
    yellow(
      "⚠ Isto usa o login oficial do provedor e consome a SUA assinatura fora do app oficial\n" +
        "  dele. É zona cinzenta dos termos e pode arriscar sua conta. Alternativa sem risco:\n" +
        `  use uma API key —  auth set ${provider} <key>.`,
    ),
  );
  if (process.stdin.isTTY) {
    const ok = (await ask("\nContinuar mesmo assim? [s/N] ")).toLowerCase();
    if (ok !== "s" && ok !== "sim" && ok !== "y" && ok !== "yes") {
      console.error(dim("cancelado."));
      return 1;
    }
  }

  const pkce = generatePkce();
  const state = randomState();
  const url = buildAuthorizeUrl(cfg, pkce, state);

  console.error(`\n${dim("Abrindo o navegador para autorizar… se não abrir, cole esta URL:")}`);
  console.error(`  ${url}\n`);
  openBrowser(url);

  let code: string;
  try {
    if (cfg.mode === "loopback") {
      console.error(dim("Esperando o callback do navegador…"));
      const cb = await waitForLoopbackCallback(cfg, state);
      code = cb.code;
    } else {
      // paste: o provider redireciona p/ uma página que mostra "<code>#<state>".
      const pasted = await ask("Cole o código mostrado na página (formato code#state): ");
      const [c, returnedState] = pasted.split("#");
      if (returnedState && returnedState !== state) {
        console.error(red("state não confere — possível CSRF. Abortei."));
        return 1;
      }
      code = (c ?? "").trim();
    }
    if (!code) {
      console.error(red("nenhum código recebido."));
      return 1;
    }
    const tok = await exchangeCode(cfg, code, pkce.verifier);
    await saveOAuth(provider, tok);
    console.error(green(`✓ login ${cfg.label} concluído — token guardado em ~/.typer/auth.json (0600).`));
    return 0;
  } catch (e) {
    console.error(red(`falha no login: ${(e as Error).message}`));
    return 1;
  }
}

async function status(): Promise<number> {
  for (const p of PROVIDERS_LIST) {
    const auth = await resolveAuth(p);
    const tag =
      auth.kind === "apiKey"
        ? green("✓ key")
        : auth.kind === "oauth"
          ? green("✓ login")
          : dim("· nada");
    console.log(`${tag}  ${p}`);
  }
  return 0;
}

export async function authCmd(flags: Flags): Promise<number> {
  const [sub, provider, keyArg] = flags.rest;

  if (!sub || sub === "status") return status();

  if (sub === "login") {
    if (!provider) {
      console.error("uso: auth login <provider>   (anthropic | openai)");
      return 2;
    }
    return login(provider);
  }

  if (sub === "logout") {
    if (!provider) {
      console.error("uso: auth logout <provider>");
      return 2;
    }
    const ok = await clearOAuth(provider);
    console.log(ok ? green(`✓ login de ${provider} removido`) : dim(`${provider} não tinha login OAuth`));
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
      key = await ask(`Chave de ${provider}: `);
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

  console.error("uso: auth status | auth login <provider> | auth logout <provider> | auth set <provider> [key]");
  return 2;
}
