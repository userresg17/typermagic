// core/router/index.ts — superfície pública do pacote @typer/router

export type {
  Provider,
  ChatRequest,
  Chunk,
  FimRequest,
  Message,
  Role,
  ToolSpec,
  ToolCall,
} from "./provider.js";
export { FakeProvider } from "./fake-provider.js";
export { AnthropicProvider } from "./anthropic.js";
export { OllamaProvider, parseOllamaChatLine } from "./ollama.js";
export { LlamaCppProvider } from "./llamacpp.js";
export { OpenAIProvider } from "./openai.js";
export { loadKey, saveKey, hasKey } from "./keys.js";
export { resolveAuth, hasAuth, authHeaders } from "./auth.js";
export type { Auth } from "./auth.js";
export { pickModel, route, DEFAULT_POLICY } from "./route.js";
export type { Task, RoutingPolicy } from "./route.js";
export { PROVIDER_MODELS, modelFor, buildProviders } from "./setup.js";
export type { BuiltProviders } from "./setup.js";
export {
  buildFimMessages,
  cleanFimCompletion,
  pickFimModel,
  FIM_SYSTEM,
} from "./fim.js";
