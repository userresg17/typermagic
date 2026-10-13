import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEngine } from "../src/engine.js";
it("leva cancelamento de runTask ao fetch Ollama e termina Cancelado", async () => {
  const root = await mkdtemp(join(tmpdir(), "typer-abort-"));
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    seen = init.signal as AbortSignal;
    readyResolve();
    return new Promise((_resolve, reject) =>
      seen!.addEventListener(
        "abort",
        () => reject(new DOMException("cancelado", "AbortError")),
        { once: true },
      ),
    );
  });
  try {
    const engine = createEngine(
      {
        root,
        surface: "gateway:kestrel",
        mode: "ask",
        provider: "ollama",
        local: true,
        model: "fixture",
        grep: false,
        signal: controller.signal,
      },
      { approve: () => false },
    );
    const collecting = (async () => {
      const events = [];
      for await (const event of engine.runTask({
        prompt: "resuma",
        context: { source: "test", text: "fala" },
      }))
        events.push(event);
      return events;
    })();
    await ready;
    controller.abort();
    const events = await collecting;
    expect(seen).toBe(controller.signal);
    expect(events.at(-1)).toEqual({
      type: "done",
      outcome: { state: "Cancelado" },
    });
  } finally {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
