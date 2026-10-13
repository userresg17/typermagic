// Inicialização do processo filho. A credencial chega por env, nunca por argv/log.
import { homedir } from "node:os";
import { join } from "node:path";
import { createBridge } from "./bridge.js";
const bridge = createBridge({
  root: process.cwd(),
  token: process.env.TYPER_BRIDGE_TOKEN ?? "",
  model: process.env.TYPER_BRIDGE_MODEL ?? "gemma4:12b",
  meetingsDir: process.env.TYPER_MEETINGS_DIR ?? join(homedir(), "Reunioes"),
});
bridge.server.listen(0, "127.0.0.1", () => {
  const address = bridge.server.address();
  if (!address || typeof address === "string")
    throw new Error("porta local indisponível");
  process.stdout.write(
    JSON.stringify({
      type: "ready",
      url: `http://127.0.0.1:${address.port}`,
      protocol: 1,
    }) + "\n",
  );
});
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void bridge.close().finally(() => process.exit(0));
  });
