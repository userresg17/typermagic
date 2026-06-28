// core/router/setup.ts
// Montagem de providers (BYOK) e modelo default por tarefa — compartilhado entre
// a CLI e o Typer Core Server (evita divergência). O núcleo é multi-LLM: registra
// Ollama sempre, nuvem se houver chave, e cai no FakeProvider offline.

import type { Provider } from "./provider.js";
import type { Task } from "./route.js";
import { FakeProvider } from "./fake-provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import { LlamaCppProvider } from "./llamacpp.js";
import { hasAuth } from "./auth.js";

/** Modelo default por provider e tarefa. --model/override sobrescreve. */
export const PROVIDER_MODELS: Record<string, Record<Task, string>> = {
  anthropic: {
    autocomplete: "claude-haiku-4-5",
    agent: "claude-opus-4-8",
    chat: "claude-opus-4-8",
  },
  openai: {
    autocomplete: "gpt-4.1-mini",
    agent: "gpt-4.1",
    chat: "gpt-4.1",
  },
  ollama: {
    autocomplete: "qwen2.5-coder",
    agent: "llama3.2",
    chat: "llama3.2",
  },
  // llama.cpp server (GPU via Vulkan): o modelo é o carregado no servidor; o nome
  // é ignorado pela API, então "local" é só rótulo.
  llamacpp: {
    autocomplete: "local",
    agent: "local",
    chat: "local",
  },
  fake: { autocomplete: "fake", agent: "fake", chat: "fake" },
};

export function modelFor(
  provider: string,
  task: Task,
  override?: string | null,
): string {
  return override ?? PROVIDER_MODELS[provider]?.[task] ?? "claude-opus-4-8";
}

export interface BuiltProviders {
  providers: Record<string, Provider>;
  preferred: string;
  online: boolean;
}

/** Registra todo provider disponível e resolve o preferido. Override explícito >
 *  --local > primeiro com chave > fake. */
export async function buildProviders(
  local = false,
  explicit: string | null = null,
): Promise<BuiltProviders> {
  const providers: Record<string, Provider> = {
    fake: new FakeProvider(),
    ollama: new OllamaProvider(),
    llamacpp: new LlamaCppProvider(),
  };
  const hasAnthropic = await hasAuth("anthropic");
  const hasOpenAI = await hasAuth("openai");
  if (hasAnthropic) providers.anthropic = new AnthropicProvider();
  if (hasOpenAI) providers.openai = new OpenAIProvider();

  const want = explicit ?? (local ? "ollama" : null);
  if (want) {
    if (!providers[want]) {
      throw new Error(
        `Provider "${want}" indisponível. Defina TYPER_${want.toUpperCase()}_KEY ou escolha: ${Object.keys(providers).join(", ")}.`,
      );
    }
    return { providers, preferred: want, online: want !== "fake" };
  }

  const preferred = hasAnthropic ? "anthropic" : hasOpenAI ? "openai" : "fake";
  return { providers, preferred, online: preferred !== "fake" };
}
