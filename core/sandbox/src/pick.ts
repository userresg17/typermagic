// core/sandbox/pick.ts
// Escolhe o sandbox. Default = subprocess (real, roda em qualquer lugar). O dono
// sobe para Docker ou Firecracker via TYPER_SANDBOX (ou o argumento `prefer`), e o
// driver só é escolhido se o host suporta — senão cai no subprocess (degrada seguro,
// nunca roda sem isolamento por acidente).

import { detectIsolation } from "./detect.js";
import { SubprocessSandbox } from "./subprocess.js";
import { DockerSandbox } from "./docker.js";
import { FirecrackerDriver } from "./firecracker.js";
import type { Sandbox, SandboxOptions } from "./types.js";

export function pickSandbox(opts: SandboxOptions = {}, prefer?: string): Sandbox {
  const iso = detectIsolation();
  const mode = (prefer ?? process.env.TYPER_SANDBOX ?? "subprocess").toLowerCase();
  if (mode === "docker" && iso.docker) return new DockerSandbox(opts);
  if (mode === "firecracker" && iso.kvm && process.env.TYPER_FC_RUN) return new FirecrackerDriver(opts);
  return new SubprocessSandbox(opts, iso);
}
