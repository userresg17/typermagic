// core/router/claude-cli.ts
// Provider que usa o CLI `claude` (Claude Code) JÁ LOGADO na máquina como backend de LLM —
// reusa a ASSINATURA (sem API key, sem re-login). Mesmo padrão do Atlas Analytics: roda
// `claude -p "<prompt>" --output-format text` com as chaves de API REMOVIDAS do ambiente
// (força cair na autenticação da assinatura, nunca numa chave paga). A saída é DADO
// não-confiável: quem usa sanitiza e nunca trata como comando.
//
// LIMITAÇÃO: devolve TEXTO puro (sem tool-calls nativas). Ótimo p/ chat; o tool-use do engine
// (browser_task etc.) NÃO dispara por aqui — pra isso precisa de um provider com tool-use real
// (Anthropic API). Bom o bastante p/ testar o assistente no Claude reusando o login da empresa.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Provider, ChatRequest, Chunk, FimRequest, Message } from "./provider.js";

const ENV_HIJACKERS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"];

function cleanEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ENV_HIJACKERS) delete e[k];
  // o serviço (systemd) pode ter PATH mínimo — garante ~/.local/bin (onde o Claude Code instala).
  const home = e.HOME ?? homedir();
  e.PATH = `${join(home, ".local", "bin")}:${e.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;
  return e;
}

/** Acha o binário `claude` (o serviço pode não ter ~/.local/bin no PATH). */
function findClaude(): string {
  const home = homedir();
  for (const c of [join(home, ".local", "bin", "claude"), "/usr/local/bin/claude", "/usr/bin/claude"]) {
    if (existsSync(c)) return c;
  }
  return "claude";
}

function buildPrompt(system: string | undefined, messages: Message[]): string {
  const parts: string[] = [];
  if (system?.trim()) parts.push(system.trim());
  for (const m of messages) {
    if (m.role === "tool") parts.push(`Resultado de ferramenta:\n${m.content}`);
    else parts.push(`${m.role === "assistant" ? "Assistente" : "Usuário"}: ${m.content}`);
  }
  parts.push("Assistente:");
  return parts.join("\n\n");
}

function runClaude(prompt: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    // -p (print/headless), texto puro, sem --model (usa o default da assinatura).
    const child = spawn(findClaude(), ["-p", prompt, "--output-format", "text"], { env: cleanEnv() });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI claude estourou o tempo"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`CLI claude indisponível (instale o Claude Code): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`CLI claude falhou (código ${code}): ${err.slice(0, 200)}`));
      else resolve(out.trim());
    });
  });
}

/** Backend LLM via Claude Code local (assinatura). */
export class ClaudeCliProvider implements Provider {
  readonly id = "claude-cli";

  async *chat(req: ChatRequest): AsyncIterable<Chunk> {
    const text = await runClaude(buildPrompt(req.system, req.messages));
    yield { text };
  }

  async fim(req: FimRequest): Promise<string> {
    const prompt = `Complete o trecho. Devolva SÓ o texto que vai no MEIO, sem explicar.\n<antes>${req.prefix}</antes>\n<depois>${req.suffix}</depois>`;
    return runClaude(prompt).catch(() => "");
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
