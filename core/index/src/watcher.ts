// core/index/watcher.ts
// Camada de gatilho: observa o disco e agenda reindexação. Fino de propósito —
// o trabalho de coalescing/backpressure mora no ReindexScheduler, e o de
// re-embeddar só o que mudou, no Indexer. Roda em segundo plano, nunca trava a
// edição. Usado por um daemon/editor; a CLI de fatia vertical ainda não o liga.

import { watch } from "node:fs";
import { join } from "node:path";
import type { ReindexScheduler } from "./reindex-scheduler.js";

export interface WatchOptions {
  /** decide se um caminho relativo deve ser observado (ex.: extensão suportada) */
  accept?: (relPath: string) => boolean;
}

export interface Watcher {
  close(): void;
}

/** Observa `root` recursivamente e agenda reindex no scheduler ao salvar. */
export function watchDirectory(
  root: string,
  scheduler: ReindexScheduler,
  opts: WatchOptions = {},
): Watcher {
  const accept = opts.accept ?? (() => true);
  const fsWatcher = watch(
    root,
    { recursive: true },
    (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (accept(rel)) scheduler.schedule(join(root, rel));
    },
  );
  return {
    close: () => fsWatcher.close(),
  };
}
