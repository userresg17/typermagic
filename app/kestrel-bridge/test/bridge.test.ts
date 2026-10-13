import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Engine,
  EngineConfig,
  EngineHost,
  TaskRequest,
} from "@typer/engine";
import { createBridge } from "../src/bridge.js";
const token = "t".repeat(64);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(
  factory?: (config: EngineConfig, host: EngineHost) => Engine,
) {
  const dir = await mkdtemp(join(tmpdir(), "typer-bridge-"));
  const bridge = createBridge({
    root: dir,
    meetingsDir: join(dir, "meetings"),
    token,
    model: "fixture",
    ...(factory ? { engineFactory: factory } : {}),
    meetingLlm: async () =>
      JSON.stringify({
        titulo: "Reunião",
        participantes: [],
        idioma: "pt",
        resumo: "Decidimos testar.",
        decisoes: ["Testar"],
        pendencias: [],
        proximosPassos: [],
      }),
  });
  await new Promise<void>((resolve) =>
    bridge.server.listen(0, "127.0.0.1", resolve),
  );
  const address = bridge.server.address();
  if (!address || typeof address === "string") throw new Error("porta");
  const url = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  });
  const request = (route: string, body?: unknown) =>
    fetch(`${url}${route}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
  return { url, request };
}
function fake(run: Engine["runTask"]): Engine {
  return { runTask: run, dispose: async () => {} } as Engine;
}
describe("ponte local Kestrel", () => {
  it("autentica e mantém contexto separado com modo/capacidades definidos pelo servidor", async () => {
    let seen: TaskRequest | undefined;
    let config: EngineConfig | undefined;
    const { request, url } = await setup((c) => {
      config = c;
      return fake(async function* (req) {
        seen = req;
        yield { type: "token", text: "Resposta" };
        yield { type: "done", outcome: { state: "Respondido" } };
      });
    });
    expect((await fetch(`${url}/health`)).status).toBe(401);
    const health = await (await request("/health")).json();
    expect(health.service).toBe("typermagic-kestrel");
    const task = await (
      await request("/tasks", {
        prompt: "Resuma",
        context: { source: "kestrel:session", text: "THEY: fala" },
        mode: "code",
        root: "/",
      })
    ).json();
    const stream = await (await request(`/tasks/${task.taskId}/events`)).text();
    expect(stream).toContain('"text":"Resposta"');
    expect(config?.mode).toBe("ask");
    expect(config?.surface).toBe("gateway:kestrel");
    expect(config?.features).toEqual({});
    expect(seen?.prompt).toBe("Resuma");
    expect(seen?.context?.text).toBe("THEY: fala");
  });
  it("cancela a tarefa e entrega AbortSignal ao motor", async () => {
    let aborted = false;
    const { request } = await setup((config) =>
      fake(async function* () {
        await new Promise<void>((resolve) =>
          config.signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        );
        yield { type: "done", outcome: { state: "Cancelado" } };
      }),
    );
    const task = await (await request("/tasks", { prompt: "Aguarde" })).json();
    const stream = await request(`/tasks/${task.taskId}/events`);
    await request(`/tasks/${task.taskId}/cancel`, {});
    expect(await stream.text()).toContain("Cancelado");
    expect(aborted).toBe(true);
  });
  it("correlaciona aprovação e aceita a decisão uma única vez", async () => {
    const { request } = await setup((_config, host) =>
      fake(async function* () {
        const approved = await host.approve(
          {} as Parameters<EngineHost["approve"]>[0],
        );
        yield { type: "token", text: approved ? "aprovado" : "rejeitado" };
        yield { type: "done", outcome: { state: "Respondido" } };
      }),
    );
    const task = await (await request("/tasks", { prompt: "Confirme" })).json();
    const stream = await request(`/tasks/${task.taskId}/events`);
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const event = JSON.parse(first.split("data: ")[1]!.split("\n")[0]!);
    expect(event.type).toBe("approval");
    expect(
      (
        await request(`/tasks/${task.taskId}/approvals/${event.approvalId}`, {
          approved: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/tasks/${task.taskId}/approvals/${event.approvalId}`, {
          approved: true,
        })
      ).status,
    ).toBe(409);
    await reader.cancel();
  });
  it("ingere sessões por ID sem duplicar reunião e recupera o resumo nas perguntas", async () => {
    let seen: TaskRequest | undefined;
    const { request } = await setup(() =>
      fake(async function* (req) {
        seen = req;
        yield { type: "token", text: "Resposta" };
        yield { type: "done", outcome: { state: "Respondido" } };
      }),
    );
    const meeting = {
      sessionId: "abc-123",
      date: "2026-10-13T12:00:00Z",
      title: "Teste",
      text: "ME: vamos testar.",
    };
    const first = await (await request("/meetings", meeting)).json();
    const second = await (await request("/meetings", meeting)).json();
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    const task = await (
      await request("/tasks", { prompt: "O que decidimos testar?" })
    ).json();
    const stream = await (await request(`/tasks/${task.taskId}/events`)).text();
    expect(stream).toContain('"type":"memory"');
    expect(seen?.context?.text).toContain("Decidimos testar");
  });
});
