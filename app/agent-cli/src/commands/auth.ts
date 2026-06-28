// app/agent-cli/src/commands/auth.ts
// Autenticação por provider. Caminhos:
//   login (menu)                → escolhe chave de API ou assinatura (OAuth), e o provider.
//   auth login <provider>       → assinatura direto (OAuth+PKCE estilo Claude Code/Codex).
//   auth set <provider> [key]   → BYOK: grava a API key no keychain (ou instrui o env).
//   auth logout <provider>      → apaga o login OAuth.
//   auth status                 → o que cada provider tem (key / login / nada).
//
// As funções interativas recebem um `ask(pergunta)` de fora, pra funcionarem tanto na CLI
// (readline própria) quanto DENTRO do REPL (reusando a readline dele, sem conflito de stdin).

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
import { green, red, dim, bold, yellow, cyan } from "../render.js";

const PROVIDERS_LIST = ["anthropic", "openai", "ollama"];

/** Uma função que faz uma pergunta no terminal e devolve a resposta (sem o \n). */
export type Ask = (question: string) => Promise<string>;

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

/** Cria um ask() com readline próprio (uso na CLL fora do REPL). */
function ownAsk(): { ask: Ask; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return { ask: (q) => rl.question(q), close: () => rl.close() };
}

/** Fluxo "entrar com a assinatura" (OAuth). Recebe o ask de fora. */
export async function loginFlow(provider: string, ask: Ask): Promise<number> {
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    console.error(red(`assinatura não disponível p/ "${provider}". Use uma API key: auth set ${provider} <key>`));
    return 2;
  }

  console.error(bold(`\nEntrar com sua assinatura ${cfg.label} (OAuth)`));
  console.error(
    yellow(
      "⚠ Isto usa o login oficial do provedor e consome a SUA assinatura fora do app oficial\n" +
        "  dele. É zona cinzenta dos termos e pode arriscar sua conta. Sem risco: use uma API key.",
    ),
  );
  if (process.stdin.isTTY) {
    const ok = (await ask("\nContinuar mesmo assim? [s/N] ")).trim().toLowerCase();
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

  try {
    let code: string;
    if (cfg.mode === "loopback") {
      console.error(dim("Esperando o callback do navegador…"));
      code = (await waitForLoopbackCallback(cfg, state)).code;
    } else {
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
    console.error(green(`✓ login ${cfg.label} concluído — guardado em ~/.typer/auth.json (0600).`));
    return 0;
  } catch (e) {
    console.error(red(`falha no login: ${(e as Error).message}`));
    return 1;
  }
}

/** Grava uma API key (BYOK), perguntando-a se não vier. */
export async function setKeyFlow(provider: string, ask: Ask, keyArg?: string): Promise<number> {
  let key = keyArg;
  if (!key) {
    if (!process.stdin.isTTY) {
      console.error("forneça a chave: auth set <provider> <key>");
      return 2;
    }
    key = (await ask(`Cole sua chave de ${provider}: `)).trim();
  }
  if (!key) return 2;
  const ok = await saveKey(provider, key);
  console.error(
    ok
      ? green(`✓ chave de ${provider} salva no keychain`)
      : red(`keychain indisponível — exporte TYPER_${provider.toUpperCase()}_KEY`),
  );
  return ok ? 0 : 1;
}

/** Menu de login estilo Claude Code: chave de API ou assinatura, p/ Anthropic ou OpenAI.
 *  Reusável pela CLI (`typermagic login`) e pelo REPL (`/login`). */
export async function loginMenu(ask: Ask): Promise<number> {
  console.error(bold("\nEntrar — como você quer autenticar?"));
  console.error(
    [
      `  ${cyan("1")}) Anthropic · ${dim("chave de API")}`,
      `  ${cyan("2")}) Anthropic · ${dim("assinatura (Claude Pro/Max)")}`,
      `  ${cyan("3")}) OpenAI · ${dim("chave de API")}`,
      `  ${cyan("4")}) OpenAI · ${dim("assinatura (ChatGPT Plus/Pro)")}`,
      `  ${cyan("0")}) cancelar`,
    ].join("\n"),
  );
  const choice = (await ask("\nescolha [0-4]: ")).trim();
  switch (choice) {
    case "1":
      return setKeyFlow("anthropic", ask);
    case "2":
      return loginFlow("anthropic", ask);
    case "3":
      return setKeyFlow("openai", ask);
    case "4":
      return loginFlow("openai", ask);
    default:
      console.error(dim("cancelado."));
      return 1;
  }
}

export async function status(): Promise<number> {
  for (const p of PROVIDERS_LIST) {
    const auth = await resolveAuth(p);
    const tag =
      auth.kind === "apiKey" ? green("✓ key") : auth.kind === "oauth" ? green("✓ login") : dim("· nada");
    console.log(`${tag}  ${p}`);
  }
  return 0;
}

export async function authCmd(flags: Flags): Promise<number> {
  const [sub, provider, keyArg] = flags.rest;

  if (!sub || sub === "status") return status();

  // subcomandos interativos: uma readline para toda a invocação.
  const { ask, close } = ownAsk();
  try {
    if (sub === "login") {
      // sem provider → menu (chave OU assinatura); com provider → assinatura direto.
      return provider ? await loginFlow(provider, ask) : await loginMenu(ask);
    }
    if (sub === "logout") {
      if (!provider) {
        console.error("uso: typermagic logout <provider>");
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
      return await setKeyFlow(provider, ask, keyArg);
    }
    console.error("uso: login | auth status | auth set <provider> [key] | auth logout <provider>");
    return 2;
  } finally {
    close();
  }
}
