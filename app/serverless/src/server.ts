#!/usr/bin/env node
// app/serverless/server.ts — sobe o handler HTTP localmente (ou num container/VM do
// dono). PORT controla a porta (default 8787). É o mesmo handler que vira função
// Lambda/Modal — aqui em processo longo.

import { createServer } from "./handler.js";

const port = Number(process.env.PORT ?? 8787);
createServer().listen(port, () => {
  process.stderr.write(`[typer-serverless] ouvindo em :${port} (POST / com JSON {prompt})\n`);
});
