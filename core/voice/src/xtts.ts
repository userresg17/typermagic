// core/voice/xtts.ts
// Ponte Node ↔ worker Python do XTTS-v2. Sobe o worker UMA vez (carrega o modelo ~2GB em CPU) e
// conversa por linhas JSON no stdin/stdout. Se o worker morrer, o próximo pedido o ressobe.
// XTTS é lento na CPU (ok — o usuário aceita), mas fala pt-BR natural e inglês nativo, 100% local.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";

export interface XttsConfig {
  /** python do venv (~/.typer/voice/xtts-venv/bin/python) */
  python: string;
  /** caminho do xtts_worker.py */
  worker: string;
  /** idioma alvo (default "pt") */
  language?: string;
  /** locutor embutido do XTTS (default = o 1º do modelo) */
  speaker?: string;
  /** wav de referência p/ clonar a voz (opcional; tem prioridade sobre speaker) */
  speakerWav?: string;
  /** nome/model override do XTTS (default xtts_v2) */
  model?: string;
  /** velocidade da fala (1.0 = normal; 1.1 = 10% mais rápido) */
  speed?: number;
}

let proc: ChildProcess | null = null;
let readyP: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

/** sobe o worker (idempotente) e resolve quando o modelo terminou de carregar. */
function startWorker(cfg: XttsConfig): Promise<void> {
  if (readyP) return readyP;
  readyP = new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, COQUI_TOS_AGREED: "1" };
    if (cfg.model) env.XTTS_MODEL = cfg.model;
    const p = spawn(cfg.python, [cfg.worker], { env, stdio: ["pipe", "pipe", "pipe"] });
    proc = p;
    let settled = false;
    const rl = createInterface({ input: p.stdout! });
    rl.on("line", (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // linha não-JSON (log solto): ignora
      }
      if (msg.ready && !settled) {
        settled = true;
        resolve();
      } else if (msg.fatal && !settled) {
        settled = true;
        reject(new Error(String(msg.fatal)));
      } else if (typeof msg.id === "number") {
        const cb = pending.get(msg.id);
        if (cb) {
          pending.delete(msg.id);
          if (msg.ok) cb.resolve();
          else cb.reject(new Error(String(msg.error ?? "XTTS falhou")));
        }
      }
    });
    p.stderr?.on("data", () => {}); // torch/coqui logam progresso no stderr: ignora
    p.on("exit", (code) => {
      proc = null;
      readyP = null;
      const err = new Error(`worker XTTS saiu (code ${code ?? "?"})`);
      for (const cb of pending.values()) cb.reject(err);
      pending.clear();
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    p.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
  return readyP;
}

/** Sintetiza `text` p/ um WAV via XTTS. 1º chamado sobe o worker (carrega o modelo — demora). */
export async function synthesizeXttsWav(text: string, outWav: string, cfg: XttsConfig): Promise<void> {
  const clean = text.trim();
  if (!clean) throw new Error("XTTS: texto vazio");
  await startWorker(cfg);
  const p = proc;
  if (!p?.stdin) throw new Error("worker XTTS indisponível");
  const id = ++seq;
  const req =
    JSON.stringify({
      id,
      text: clean,
      out: outWav,
      language: cfg.language ?? "pt",
      ...(cfg.speaker ? { speaker: cfg.speaker } : {}),
      ...(cfg.speakerWav ? { speaker_wav: cfg.speakerWav } : {}),
      ...(cfg.speed ? { speed: cfg.speed } : {}),
    }) + "\n";
  const done = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
  p.stdin.write(req);
  return done;
}

/** XTTS pronto? (o python do venv e o worker existem — o modelo baixa no 1º uso). */
export function xttsReady(cfg: XttsConfig): boolean {
  return existsSync(cfg.python) && existsSync(cfg.worker);
}
