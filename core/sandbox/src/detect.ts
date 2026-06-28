// core/sandbox/detect.ts
// Detecta os primitivos de isolamento do host, uma vez (memoizado). Não exige
// nenhum — só descobre o mais forte disponível. bubblewrap (bwrap) é o preferido
// p/ subprocess (FS read-only + sem rede + namespaces); unshare-net é o fallback;
// Docker e /dev/kvm (Firecracker) são drivers opt-in mais fortes.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface Isolation {
  bwrap: boolean;
  firejail: boolean;
  unshareNet: boolean;
  docker: boolean;
  kvm: boolean;
}

function has(bin: string): boolean {
  try {
    return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

let cached: Isolation | null = null;

export function detectIsolation(): Isolation {
  if (cached) return cached;
  let unshareNet = false;
  if (has("unshare")) {
    try {
      // -r mapeia root num novo user namespace; -n nova net namespace (sem rede)
      unshareNet = spawnSync("unshare", ["-rn", "true"], { stdio: "ignore" }).status === 0;
    } catch {
      unshareNet = false;
    }
  }
  cached = {
    bwrap: has("bwrap"),
    firejail: has("firejail"),
    unshareNet,
    docker: has("docker"),
    kvm: existsSync("/dev/kvm"),
  };
  return cached;
}

/** Só p/ teste: zera o cache da detecção. */
export function resetDetection(): void {
  cached = null;
}
