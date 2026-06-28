// Testes dos mapeadores de tool-use por provider (formatos das APIs) — item 1.
import { describe, it, expect } from "vitest";
import { toAnthropicMessages, toAnthropicTools } from "../src/anthropic.js";
import { toOpenAIMessages, toOpenAITools } from "../src/openai.js";
import {
  toOllamaMessages,
  toOllamaTools,
  parseOllamaToolCalls,
} from "../src/ollama.js";
import type { Message, ToolSpec } from "../src/provider.js";

const tools: ToolSpec[] = [
  { name: "fs_read", description: "lê arquivo", inputSchema: { type: "object" } },
];

const convo: Message[] = [
  { role: "user", content: "leia o arquivo" },
  {
    role: "assistant",
    content: "vou ler",
    toolCalls: [{ id: "c1", name: "fs_read", arguments: { path: "a.ts" } }],
  },
  { role: "tool", content: "conteúdo de a.ts", toolCallId: "c1" },
];

describe("Anthropic tool mapping", () => {
  it("tools viram {name, description, input_schema}", () => {
    expect(toAnthropicTools(tools)).toEqual([
      { name: "fs_read", description: "lê arquivo", input_schema: { type: "object" } },
    ]);
    expect(toAnthropicTools([])).toBeUndefined();
  });
  it("assistant.toolCalls vira tool_use; role tool vira user/tool_result", () => {
    expect(toAnthropicMessages(convo)).toEqual([
      { role: "user", content: "leia o arquivo" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "vou ler" },
          { type: "tool_use", id: "c1", name: "fs_read", input: { path: "a.ts" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "c1", content: "conteúdo de a.ts" }],
      },
    ]);
  });
});

describe("OpenAI tool mapping", () => {
  it("tools viram {type:function, function:{name,description,parameters}}", () => {
    expect(toOpenAITools(tools)).toEqual([
      {
        type: "function",
        function: { name: "fs_read", description: "lê arquivo", parameters: { type: "object" } },
      },
    ]);
  });
  it("assistant.toolCalls com arguments stringificados; role tool com tool_call_id", () => {
    expect(toOpenAIMessages("sis", convo)).toEqual([
      { role: "system", content: "sis" },
      { role: "user", content: "leia o arquivo" },
      {
        role: "assistant",
        content: "vou ler",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "fs_read", arguments: JSON.stringify({ path: "a.ts" }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "conteúdo de a.ts" },
    ]);
  });
});

describe("Ollama tool mapping", () => {
  it("tools e tool_calls com arguments como objeto", () => {
    expect(toOllamaTools(tools)).toEqual([
      {
        type: "function",
        function: { name: "fs_read", description: "lê arquivo", parameters: { type: "object" } },
      },
    ]);
    expect(toOllamaMessages(undefined, convo)).toEqual([
      { role: "user", content: "leia o arquivo" },
      {
        role: "assistant",
        content: "vou ler",
        tool_calls: [{ function: { name: "fs_read", arguments: { path: "a.ts" } } }],
      },
      { role: "tool", content: "conteúdo de a.ts" },
    ]);
  });
  it("parseOllamaToolCalls extrai tool_calls de uma linha NDJSON", () => {
    const line = JSON.stringify({
      message: { tool_calls: [{ function: { name: "fs_read", arguments: { path: "x" } } }] },
    });
    const calls = parseOllamaToolCalls(line);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.function?.name).toBe("fs_read");
    expect(parseOllamaToolCalls("lixo")).toEqual([]);
  });
});
