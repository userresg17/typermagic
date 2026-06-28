// core/sandbox/index.ts — superfície pública do @typer/sandbox.

export type { Sandbox, SandboxOptions, RunResult } from "./types.js";
export { detectIsolation, resetDetection, type Isolation } from "./detect.js";
export { SubprocessSandbox } from "./subprocess.js";
export { DockerSandbox } from "./docker.js";
export { FirecrackerDriver } from "./firecracker.js";
export { pickSandbox } from "./pick.js";
