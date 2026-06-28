// app/serverless/handler.ts
// Adaptador serverless — roda uma tarefa do agente sob demanda e devolve o resumo
// dos eventos. Real: um handler HTTP (node:http) e um export no formato Lambda/Modal.
// O deploy é do dono (credenciais/infra); aqui está o código que acende. Superfície
// "scheduler" (read+write+exec, sem rede livre); approval "never" → o policy gate nega
// ação irreversível. Timeout cooperativo p/ caber no teto do provider serverless.

import { createServer as httpCreateServer, type Server } from "node:http";
import { createEngine, type EngineEvent } from "@typer/engine";

export interface ServerlessRequest {
  root?: string;
  prompt: string;
  provider?: string | null;
  local?: boolean;
  mode?: "code" | "ask" | "architect" | "debug" | "gather";
  timeoutMs?: number;
}

export interface ServerlessResponse {
  outcome: unknown;
  /** texto da resposta (tokens concatenados) */
  text: string;
  /** resumo dos eventos (sem token/info) — plan/seal/policy/cost/audit/done */
  events: EngineEvent[];
}

export async function handleTask(req: ServerlessRequest): Promise<ServerlessResponse> {
  const engine = createEngine(
    {
      root: req.root ?? process.cwd(),
      surface: "scheduler",
      provider: req.provider ?? null,
      local: req.local ?? false,
      mode: req.mode ?? "ask",
      approval: "never",
    },
    { approve: () => false },
  );
  const deadline = Date.now() + (req.timeoutMs ?? 60_000);
  let text = "";
  let outcome: unknown = { state: "SemEdicoes" };
  const events: EngineEvent[] = [];
  try {
    for await (const ev of engine.runTask({ prompt: req.prompt })) {
      if (ev.type === "token") text += ev.text;
      else if (ev.type === "done") outcome = ev.outcome;
      else if (ev.type !== "info") events.push(ev);
      if (Date.now() > deadline) break; // timeout cooperativo
    }
  } finally {
    await engine.dispose();
  }
  return { outcome, text, events };
}

/** Servidor HTTP: POST / com JSON { prompt, ... } → JSON ServerlessResponse. */
export function createServer(): Server {
  return httpCreateServer(async (rq, rs) => {
    if (rq.method !== "POST") {
      rs.writeHead(405, { "content-type": "text/plain" });
      rs.end("POST only");
      return;
    }
    let body = "";
    for await (const c of rq) body += c;
    try {
      const req = JSON.parse(body || "{}") as ServerlessRequest;
      if (!req.prompt) {
        rs.writeHead(400, { "content-type": "application/json" });
        rs.end(JSON.stringify({ error: "campo 'prompt' obrigatório" }));
        return;
      }
      const out = await handleTask(req);
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify(out));
    } catch (e) {
      rs.writeHead(400, { "content-type": "application/json" });
      rs.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
}

/** Export no formato AWS Lambda / Modal (event com body JSON). */
export async function lambdaHandler(event: { body?: string }): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  try {
    const req = JSON.parse(event.body ?? "{}") as ServerlessRequest;
    const out = await handleTask(req);
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(out) };
  } catch (e) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    };
  }
}
