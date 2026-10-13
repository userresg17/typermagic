// Ponte Kestrel: perguntas/resumos pelo motor, sem ferramentas de escrita/desktop.
import {
  createServer,
  type ServerResponse,
  type IncomingMessage,
} from "node:http";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import {
  createEngine,
  buildEngineProvider,
  READONLY_GRANT,
  type Engine,
  type EngineConfig,
  type EngineHost,
  type TaskRequest,
} from "@typer/engine";
import { MeetingsHub, type Llm } from "@typer/meetings";

type Approval = {
  resolve: (value: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Task = {
  id: string;
  controller: AbortController;
  events: unknown[];
  listeners: Set<ServerResponse>;
  approvals: Map<string, Approval>;
  finished: boolean;
  created: number;
  bytes: number;
};
export interface BridgeOptions {
  root: string;
  token: string;
  model: string;
  meetingsDir: string;
  engineFactory?: (config: EngineConfig, host: EngineHost) => Engine;
  meetingLlm?: Llm;
  ttlMs?: number;
}
const LIMIT = 192 * 1024;
const hash = (s: string) => createHash("sha256").update(s).digest();
function string(value: unknown, max: number, name: string): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`campo inválido: ${name}`);
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("objeto esperado");
  return value as Record<string, unknown>;
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > LIMIT) throw new Error("corpo excede limite");
    chunks.push(Buffer.from(chunk));
  }
  return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
export function createBridge(options: BridgeOptions) {
  if (options.token.length < 32)
    throw new Error("credencial local insuficiente");
  const tasks = new Map<string, Task>();
  const factory = options.engineFactory ?? createEngine;
  const pendingMeetings = new Map<string, Promise<unknown>>();
  function emit(task: Task, event: unknown): void {
    if (task.finished) return;
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    task.bytes += Buffer.byteLength(frame);
    if (task.bytes > 4 * 1024 * 1024) {
      task.controller.abort();
      return;
    }
    task.events.push(event);
    for (const listener of task.listeners) {
      if (listener.writableLength > 1024 * 1024) {
        listener.destroy();
        task.listeners.delete(listener);
      } else listener.write(frame);
    }
  }
  function finish(task: Task): void {
    task.finished = true;
    for (const approval of task.approvals.values()) {
      clearTimeout(approval.timer);
      approval.resolve(false);
    }
    task.approvals.clear();
    for (const listener of task.listeners) listener.end();
    task.listeners.clear();
  }
  async function run(
    task: Task,
    request: TaskRequest,
    model: string,
    instruction: string,
  ): Promise<void> {
    const engine = factory(
      {
        root: options.root,
        surface: "gateway:kestrel",
        mode: "ask",
        provider: "ollama",
        local: true,
        model,
        grep: false,
        capabilities: READONLY_GRANT,
        features: {},
        signal: task.controller.signal,
        responseInstruction: `Você é um copiloto de conversas. Responda em português do Brasil usando os dados de referência. Não invente fatos nem execute ações.\n${instruction}`,
      },
      {
        approve: (req) =>
          new Promise<boolean>((resolve) => {
            const approvalId = randomUUID();
            const timer = setTimeout(() => {
              task.approvals.delete(approvalId);
              resolve(false);
            }, 60000);
            task.approvals.set(approvalId, { resolve, timer });
            emit(task, { type: "approval", approvalId, request: req });
          }),
      },
    );
    let terminal = false;
    try {
      // Recall lexical limitado da Central: dados históricos, nunca ordens.
      const hub = new MeetingsHub({
        dir: options.meetingsDir,
        llm: async () => "",
      });
      const hits = await hub.search(request.prompt, { k: 3 });
      if (hits.length) {
        const prior = JSON.stringify(
          hits.map((hit) => ({
            id: hit.meeting.id,
            date: hit.meeting.date,
            summary: hit.meeting.summary,
          })),
        ).slice(0, 8000);
        request.context = {
          source: request.context?.source ?? "kestrel",
          text: `${request.context?.text ?? ""}\n\nReuniões anteriores (referência):\n${prior}`,
        };
        emit(task, { type: "memory", action: "recall", count: hits.length });
      }
      for await (const event of engine.runTask(request)) {
        if (task.controller.signal.aborted) break;
        if (event.type === "approval") continue; // o host já emitiu o evento correlacionado
        emit(task, event);
        if (event.type === "done" || event.type === "error") terminal = true;
      }
      if (task.controller.signal.aborted)
        emit(task, { type: "done", outcome: { state: "Cancelado" } });
      else if (!terminal)
        emit(task, { type: "error", message: "motor encerrou sem resultado" });
    } catch (error) {
      emit(
        task,
        task.controller.signal.aborted
          ? { type: "done", outcome: { state: "Cancelado" } }
          : {
              type: "error",
              message:
                error instanceof Error ? error.message : "falha no motor",
            },
      );
    } finally {
      finish(task);
      await engine.dispose();
    }
  }
  const server = createServer(async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (
      req.headers.origin ||
      !timingSafeEqual(hash(token), hash(options.token))
    ) {
      json(res, 401, { error: "não autorizado" });
      return;
    }
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, {
          protocol: 1,
          service: "typermagic-kestrel",
          provider: "ollama",
          model: options.model,
          mode: "ask",
          meetings: true,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/tasks") {
        if ([...tasks.values()].filter((t) => !t.finished).length >= 2) {
          json(res, 429, { error: "tarefas locais ocupadas" });
          return;
        }
        const data = await body(req);
        const prompt = string(data.prompt, 8000, "prompt").trim();
        if (!prompt) throw new Error("pedido vazio");
        const model =
          data.model === undefined
            ? options.model
            : string(data.model, 200, "model");
        if (!model.trim() || /:cloud$/.test(model))
          throw new Error("escolha modelo local");
        const instruction =
          data.instructions === undefined
            ? ""
            : string(data.instructions, 16000, "instructions");
        const request: TaskRequest = { prompt, mode: "ask" };
        if (data.context !== undefined) {
          const context = object(data.context);
          request.context = {
            source: string(context.source, 200, "context.source"),
            text: string(context.text, 64000, "context.text"),
          };
        }
        if (data.history !== undefined) {
          if (!Array.isArray(data.history) || data.history.length > 20)
            throw new Error("histórico inválido");
          request.history = data.history.map((raw) => {
            const entry = object(raw);
            if (entry.role !== "user" && entry.role !== "assistant")
              throw new Error("papel inválido");
            return {
              role: entry.role,
              content: string(entry.content, 8000, "history.content"),
            };
          });
        }
        const task: Task = {
          id: randomUUID(),
          controller: new AbortController(),
          events: [],
          listeners: new Set(),
          approvals: new Map(),
          finished: false,
          created: Date.now(),
          bytes: 0,
        };
        tasks.set(task.id, task);
        json(res, 202, { taskId: task.id });
        void run(task, request, model, instruction).catch(() => {
          task.controller.abort();
          finish(task);
        });
        return;
      }
      const match = url.pathname.match(
        /^\/tasks\/([a-z0-9-]+)\/(events|cancel|approvals\/([a-z0-9-]+))$/,
      );
      if (match) {
        const task = tasks.get(match[1]!);
        if (!task) {
          json(res, 404, { error: "tarefa não encontrada" });
          return;
        }
        if (req.method === "GET" && match[2] === "events") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          });
          res.flushHeaders();
          for (const event of task.events)
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (task.finished) res.end();
          else {
            task.listeners.add(res);
            const heartbeat = setInterval(
              () => res.write(": heartbeat\n\n"),
              15000,
            );
            res.on("close", () => {
              clearInterval(heartbeat);
              task.listeners.delete(res);
              if (!task.finished && !task.listeners.size)
                task.controller.abort();
            });
          }
          return;
        }
        if (req.method === "POST" && match[2] === "cancel") {
          task.controller.abort();
          for (const approval of task.approvals.values())
            approval.resolve(false);
          json(res, 200, { cancelled: true });
          return;
        }
        if (req.method === "POST" && match[3]) {
          const data = await body(req);
          if (typeof data.approved !== "boolean")
            throw new Error("decisão inválida");
          const approval = task.approvals.get(match[3]);
          if (!approval) {
            json(res, 409, { error: "aprovação encerrada" });
            return;
          }
          clearTimeout(approval.timer);
          task.approvals.delete(match[3]);
          approval.resolve(data.approved);
          json(res, 200, { received: true });
          return;
        }
      }
      if (req.method === "POST" && url.pathname === "/meetings") {
        const data = await body(req);
        const sessionId = string(data.sessionId, 80, "sessionId");
        if (!/^[a-zA-Z0-9-]+$/.test(sessionId))
          throw new Error("sessão inválida");
        const text = string(data.text, 160000, "text");
        if (!text.trim()) throw new Error("reunião vazia");
        const date = string(data.date, 64, "date");
        if (!Number.isFinite(Date.parse(date)))
          throw new Error("data inválida");
        const title = string(data.title, 200, "title");
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const sourceKey = `kestrel:${sessionId}`;
        let pending = pendingMeetings.get(sourceKey);
        if (!pending) {
          const llm: Llm =
            options.meetingLlm ??
            (async (system, user) => {
              const bundle = await buildEngineProvider({
                local: true,
                provider: "ollama",
                model: options.model,
                task: "chat",
                signal: controller.signal,
              });
              let answer = "";
              for await (const chunk of bundle.provider.chat({
                model: bundle.model,
                system,
                messages: [{ role: "user", content: user }],
                maxTokens: 4096,
              }))
                answer += chunk.text;
              return answer;
            });
          const hub = new MeetingsHub({
            dir: options.meetingsDir,
            llm,
            summarize: { maxInputChars: 24000 },
          });
          pending = hub
            .ingest({
              sourceKey,
              platform: "arquivo",
              date,
              title,
              text,
              origin: `Kestrel sessão ${sessionId}`,
            })
            .then((result) => ({
              id: result.meeting.id,
              file: result.meeting.file,
              summary: result.meeting.summary,
              duplicate: result.duplicate,
            }));
          pendingMeetings.set(sourceKey, pending);
          void pending
            .finally(() => pendingMeetings.delete(sourceKey))
            .catch(() => {});
        }
        json(res, 200, await pending);
        return;
      }
      json(res, 404, { error: "rota não encontrada" });
    } catch (error) {
      if (!res.headersSent)
        json(res, 400, {
          error: error instanceof Error ? error.message : "pedido inválido",
        });
      else res.end();
    }
  });
  const cleanup = setInterval(() => {
    for (const [id, task] of tasks) {
      if (Date.now() - task.created > (options.ttlMs ?? 5 * 60000)) {
        task.controller.abort();
        finish(task);
        tasks.delete(id);
      }
    }
  }, 10000);
  cleanup.unref();
  return {
    server,
    close: async () => {
      clearInterval(cleanup);
      for (const task of tasks.values()) {
        task.controller.abort();
        finish(task);
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
