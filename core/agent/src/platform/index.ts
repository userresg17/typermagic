// core/agent/platform/index.ts — escolhe a Platform pelo SO.
export type { Platform, DesktopSession, DesktopExtras, Screenshot, ScreenSize, AxTree, AxNode } from "./types.js";
export { MacOSPlatform, findRepoRoot, type MacOSOptions } from "./macos.js";
export { LinuxPlatform } from "./linux.js";

import { MacOSPlatform, type MacOSOptions } from "./macos.js";
import { LinuxPlatform } from "./linux.js";
import type { DesktopSession } from "./types.js";

export function pickPlatform(opts: MacOSOptions = {}): DesktopSession {
  if (process.platform === "darwin") return new MacOSPlatform(opts);
  if (process.platform === "linux") return new LinuxPlatform();
  throw new Error(`plataforma sem suporte a desktop: ${process.platform}`);
}
