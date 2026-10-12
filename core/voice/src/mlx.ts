// core/voice/mlx.ts
// Ponte Node ↔ worker Python de voz na GPU do Mac (mlx-audio). Sobe o worker UMA vez (modelo
// fica quente) e conversa por linhas JSON. Mesmo desenho do xtts.ts. Default: Kokoro-82M pt-BR.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";

export interface MlxTtsConfig {
  python: string;
  worker: string;
  /** repo HF do modelo MLX (default mlx-community/Kokoro-82M-bf16) */
  model?: string;
  /** voz (Kokoro pt-BR: pf_dora | pm_alex | pm_santa) */
  voice?: string;
  /** código de idioma do modelo (Kokoro pt-BR: "p") */
  lang?: string;
  speed?: number;
}

let proc: ChildProcess | null = null;
let readyP: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

function startWorker(cfg: MlxTtsConfig): Promise<void> {
  if (readyP) return readyP;
  readyP = new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (cfg.model) env.MLX_TTS_MODEL = cfg.model;
    if (cfg.voice) env.MLX_TTS_VOICE = cfg.voice;
    if (cfg.lang) env.MLX_TTS_LANG = cfg.lang;
    const p = spawn(cfg.python, [cfg.worker], { env, stdio: ["pipe", "pipe", "pipe"] });
    proc = p;
    let settled = false;
    createInterface({ input: p.stdout! }).on("line", (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
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
          else cb.reject(new Error(String(msg.error ?? "voz MLX falhou")));
        }
      }
    });
    p.stderr?.on("data", () => {});
    p.on("exit", (code) => {
      proc = null;
      readyP = null;
      const err = new Error(`worker MLX saiu (code ${code ?? "?"})`);
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

export async function synthesizeMlxWav(text: string, outWav: string, cfg: MlxTtsConfig): Promise<void> {
  const clean = text.trim();
  if (!clean) throw new Error("voz MLX: texto vazio");
  await startWorker(cfg);
  const p = proc;
  if (!p?.stdin) throw new Error("worker MLX indisponível");
  const id = ++seq;
  const done = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
  p.stdin.write(JSON.stringify({ id, text: clean, out: outWav, ...(cfg.voice ? { voice: cfg.voice } : {}), ...(cfg.lang ? { lang: cfg.lang } : {}), ...(cfg.speed ? { speed: cfg.speed } : {}) }) + "\n");
  return done;
}

export function mlxReady(cfg: MlxTtsConfig): boolean {
  return existsSync(cfg.python) && existsSync(cfg.worker);
}
