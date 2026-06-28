import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Indexer } from "../src/indexer.js";
import { MemoryVectorStore } from "../src/memory-store.js";
import { FakeEmbedder } from "../src/embedders.js";
import { ReindexScheduler } from "../src/reindex-scheduler.js";

describe("Indexer — incremental por hash de chunk", () => {
  const v1 = "function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}";

  it("re-embeda só os chunks que mudaram", async () => {
    const idx = new Indexer(new FakeEmbedder(), new MemoryVectorStore(), {
      maxLines: 3,
    });

    const s1 = await idx.indexFile("m.ts", v1);
    expect(s1.chunks).toBeGreaterThanOrEqual(2);
    expect(s1.embedded).toBe(s1.chunks);
    expect(s1.reused).toBe(0);

    // reindex idêntico: nada re-embeda
    const s2 = await idx.indexFile("m.ts", v1);
    expect(s2.embedded).toBe(0);
    expect(s2.reused).toBe(s2.chunks);

    // muda só a função a(): só o chunk dela re-embeda
    const v3 = "function a() {\n  return 99;\n}\nfunction b() {\n  return 2;\n}";
    const s3 = await idx.indexFile("m.ts", v3);
    expect(s3.embedded).toBe(1);
    expect(s3.reused).toBe(s3.chunks - 1);
  });
});

describe("ReindexScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesce edições rápidas do mesmo arquivo numa só reindex", async () => {
    const fn = vi.fn(async () => {});
    const s = new ReindexScheduler(fn, { debounceMs: 100 });
    s.schedule("a.ts");
    s.schedule("a.ts");
    s.schedule("a.ts");
    expect(s.pendingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a.ts");
  });

  it("re-enfileira um save que chega durante a reindexação (backpressure)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) await gate;
    });
    const s = new ReindexScheduler(fn, { debounceMs: 100 });

    s.schedule("a.ts");
    await vi.advanceTimersByTimeAsync(100); // roda a 1ª, fica in-flight no gate
    expect(fn).toHaveBeenCalledTimes(1);

    s.schedule("a.ts");
    await vi.advanceTimersByTimeAsync(100); // timer dispara, mas está in-flight -> enfileira
    expect(fn).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2); // a enfileirada rodou
  });
});
