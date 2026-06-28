// scripts/check-licenses.mjs
// Gate de licença (ADR-002), cross-platform. Invoca o license-checker com argv
// explícito via node, sem shell — assim a lista separada por ";" não é
// interpretada pelo cmd do Windows, onde as aspas quebravam o CI.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bin = require.resolve("license-checker/bin/license-checker");

const ALLOW = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
].join(";");

const res = spawnSync(
  process.execPath,
  [bin, "--onlyAllow", ALLOW, "--excludePrivatePackages"],
  { stdio: "inherit" },
);

if (res.error) {
  console.error("Falha ao rodar o license-checker:", res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
