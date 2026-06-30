// core/engine/engine.ts
// createEngine — a fachada concreta. É o lar da orquestração que antes vivia em
// app/cli/src/main.ts (linhas 483-709): tarefa → embedder → contexto (ripgrep ou
// híbrido) → recall de memória/skills → MCP → re-primar handoff → providers + custo
// → despacho (chat / edit / loop+selo / tool-use) → handoff/consolidação → custo.
// A diferença: cada console.error vira um EngineEvent e cada chunk de chat vira um
// `token`. A lógica de negócio não muda — muda quem recebe a saída. Toda superfície
// consome o mesmo runTask; o Typer Core Server consome as primitivas.

import {
  resolveMode,
  runEditLoop,
  runToolLoop,
  reachSkillSection,
  browserSkillSection,
  memorySkillSection,
  AuditTrail,
  ApprovalGate,
  type AttemptInfo,
  type ApprovalPolicy,
  type ToolExecutor,
  type AuditEntry,
} from "@typer/agent";
import {
  parseEdits,
  planEdits,
  writePlan,
  EDIT_SYSTEM_INSTRUCTION,
  type FilePlan,
} from "@typer/edit";
import type { Provider } from "@typer/router";
import type { SealResult } from "@typer/seal";
import type { Handoff } from "@typer/handoff";
import type { MarkdownMemory } from "@typer/memory";
import type { VerifiedSkillStore } from "@typer/skills";
import type { McpRegistry } from "@typer/mcp";
import type { Embedder } from "@typer/index";

import type {
  Engine,
  EngineConfig,
  EngineEvent,
  EngineHost,
  TaskRequest,
  TaskOutcome,
} from "./types.js";
import { EventQueue } from "./event-queue.js";
import { defaultGrantFor } from "./capability.js";
import { SealRouter } from "./seal-router.js";
import {
  pickEngineEmbedder,
  buildRipgrepContext,
  buildHybridContext,
  appendSection,
  prependSection,
} from "./context.js";
import { buildEngineProvider } from "./providers.js";
import { openMemory, recallSection, recordEpisode, maybeConsolidate } from "./memory.js";
import { openSkills, recallSkillsSection, induceAndSeal } from "./skills.js";
import { loadHandoff, rePrimeSection, updateHandoff } from "./handoff.js";
import { loadMcpConfig, connectMcp, mcpToolsSection, mcpExecutor } from "./mcp.js";
import { callRegistryTool, engineToolExecutor, type ToolCallDeps, type PolicyNotice } from "./tools.js";
import { loadPolicy, isAutonomous } from "./policy.js";
import { pickSandbox } from "@typer/sandbox";
import { recordTrajectory } from "@typer/trajectory";

type Emit = (ev: EngineEvent) => void;

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class EngineImpl implements Engine {
  private readonly auditTrail = new AuditTrail();
  private readonly registries = new Set<McpRegistry>();

  constructor(
    private readonly config: EngineConfig,
    private readonly host: EngineHost,
  ) {}

  async *runTask(req: TaskRequest): AsyncIterable<EngineEvent> {
    const q = new EventQueue<EngineEvent>();
    const work = (async () => {
      let outcome: TaskOutcome | undefined;
      try {
        outcome = await this.execute(req, (ev) => q.push(ev));
      } catch (err) {
        q.push({ type: "error", message: asMessage(err) });
      } finally {
        if (outcome) q.push({ type: "done", outcome });
        q.close();
      }
    })();
    const record = this.config.record ?? false;
    const collected: EngineEvent[] = [];
    try {
      for await (const ev of q.drain()) {
        if (record) collected.push(ev);
        yield ev;
      }
    } finally {
      await work;
      if (record) {
        // grava a trajetória assinada (não fatal se falhar)
        try {
          await recordTrajectory(this.config.root, req.prompt, collected);
        } catch {
          /* trajetória é best-effort */
        }
      }
    }
  }

  private async execute(req: TaskRequest, emit: Emit): Promise<TaskOutcome> {
    const { root } = this.config;
    const local = this.config.local ?? false;
    const features = this.config.features ?? {};
    const mode = resolveMode(req.mode ?? this.config.mode ?? null);
    const files = req.files ?? [];
    const grep = this.config.grep ?? true;
    const auditBefore = this.auditTrail.entries().length;

    // Embedder compartilhado por retrieval híbrido, memória, skills e consolidação.
    let embedder: Embedder | null = null;
    if (features.semantic || features.memory || features.skills || features.consolidate) {
      const choice = await pickEngineEmbedder(local);
      embedder = choice.embedder;
      emit({ type: "info", message: `embeddings=${choice.id}${choice.online ? "" : " (offline)"}` });
    }

    // Contexto: híbrido (opt-in) ou ripgrep cru (default).
    const ctx =
      features.semantic && embedder
        ? await buildHybridContext({ root, files, grep, query: req.prompt, embedder })
        : await buildRipgrepContext(root, files, grep, req.prompt);
    let contextBlock = ctx.block;
    if (ctx.files || ctx.snippets) {
      emit({ type: "context", files: ctx.files, snippets: ctx.snippets, approxTokens: ctx.approxTokens });
    }

    // Memória (recall antes; grava episódio no sucesso, mais abaixo).
    let mem: MarkdownMemory | null = null;
    if ((features.memory || features.consolidate) && embedder) {
      mem = await openMemory(root, embedder);
      if (features.memory) {
        const { section, count } = await recallSection(mem, req.prompt);
        if (section) {
          contextBlock = appendSection(contextBlock, section);
          emit({ type: "memory", action: "recall", count });
        }
      }
    }

    // Skills verificadas (recall; induz+sela no sucesso).
    let skillStore: VerifiedSkillStore | null = null;
    if (features.skills && embedder) {
      skillStore = await openSkills(root, embedder);
      const { section, count } = await recallSkillsSection(skillStore, req.prompt);
      if (section) {
        contextBlock = appendSection(contextBlock, section);
        emit({ type: "info", message: `skills: ${count} verificada(s) relevante(s)` });
      }
    }

    // MCP: read-only → tool-use executa as ferramentas; edição → só descoberta.
    let registry: McpRegistry | null = null;
    let toolExec: ToolExecutor | null = null;
    if (features.mcp) {
      const configs = await loadMcpConfig(root);
      if (configs.length === 0) {
        emit({ type: "info", message: "MCP: nenhum servidor em .typer/mcp.json" });
      } else {
        const { registry: reg, tools, failures } = await connectMcp(configs);
        for (const f of failures) emit({ type: "info", message: `MCP aviso: ${f}` });
        if (!mode.allowsEdit && tools.length > 0) {
          registry = reg;
          this.registries.add(reg);
          toolExec = mcpExecutor(reg);
          emit({ type: "info", message: `MCP: ${tools.length} ferramenta(s) p/ tool-use` });
        } else {
          const section = mcpToolsSection(tools);
          if (section) {
            contextBlock = appendSection(contextBlock, section);
            emit({ type: "info", message: `MCP: ${tools.length} ferramenta(s) descoberta(s)` });
          }
          await reg.closeAll();
        }
      }
    }

    // Ferramentas internas (F1): em modos SOMENTE-LEITURA (ask/gather/architect) o agente
    // ganha as 50 ferramentas p/ EXPLORAR o projeto de verdade (ler arquivos, listar, grep)
    // em vez de só responder do contexto pré-recuperado. Modos de edição (code/debug) seguem
    // no loop de edição com selo+teste. Tudo sob broker + policy gate + selo.
    let agentToolDeps: ToolCallDeps | undefined;
    if (features.tools && !toolExec && !mode.allowsEdit) {
      agentToolDeps = await this.buildToolDeps({
        origin: "agent",
        embedder,
        onPolicy: (n) =>
          emit({
            type: "policy",
            tool: n.tool,
            decision: n.decision,
            ...(n.reason !== undefined ? { reason: n.reason } : {}),
            ...(n.preview !== undefined ? { preview: n.preview } : {}),
          }),
      });
      toolExec = engineToolExecutor(agentToolDeps);
      emit({ type: "info", message: "ferramentas internas habilitadas (broker + policy + selo)" });
    }

    // Handoff: re-prima a âncora (Tier 0 + Tier 2) no TOPO do contexto.
    let prevHandoff: Handoff | null = null;
    if (features.handoff) {
      prevHandoff = await loadHandoff(root);
      if (prevHandoff) {
        contextBlock = prependSection(contextBlock, rePrimeSection(prevHandoff));
        emit({ type: "handoff", reprimed: true });
      }
    }

    const approval: ApprovalPolicy = this.config.approval ?? "first-only";
    const attempts = this.config.attempts ?? 2;

    // Providers + roteamento por tarefa + medidor de custo.
    const { provider, model, online, meter } = await buildEngineProvider({
      local,
      provider: this.config.provider ?? null,
      model: this.config.model ?? null,
      task: mode.task,
    });
    emit({
      type: "info",
      message: `provider=${provider.id} model=${online ? model : "—"} modo=${mode.name}${online ? "" : " (offline: FakeProvider)"}`,
    });

    // sub-agente de navegador (browser_task): injeta o caller de LLM com o MESMO provider/model
    // do loop (os deps foram montados ANTES do provider existir; preenchemos agora).
    if (agentToolDeps) {
      agentToolDeps.llm = async (system, messages) => {
        let text = "";
        for await (const chunk of provider.chat({ messages, model, system, maxTokens: 1024 })) text += chunk.text;
        return text;
      };
    }

    let outcome: TaskOutcome;
    try {
      if (toolExec) {
        outcome = await this.runToolUse(emit, provider, model, contextBlock, req.prompt, mode.system, toolExec, req.history);
      } else if (mode.allowsEdit) {
        outcome = this.config.testCommand
          ? await this.runEditLoop(emit, provider, model, root, contextBlock, req.prompt, mode.system, this.config.testCommand, attempts, approval, mem, skillStore)
          : await this.runEdit(emit, provider, model, root, contextBlock, req.prompt, mode.system, mem);
      } else {
        outcome = await this.runChat(emit, provider, model, contextBlock, req.prompt, mode.system, req.history);
      }

      // Handoff: no sucesso de um modo que edita, anexa a decisão e persiste.
      if (
        features.handoff &&
        mode.allowsEdit &&
        (outcome.state === "Verificado" || outcome.state === "Aplicado")
      ) {
        const next = await updateHandoff(root, prevHandoff, { task: req.prompt, mem });
        emit({ type: "handoff", reprimed: false, decisions: next.tier1.entries.length });
      }

      // Consolidação: explícita (consolidate) ou automática (vault acima do limiar).
      if (mem) {
        const distilled = await maybeConsolidate(mem, provider, model, features.consolidate ?? false);
        if (distilled > 0) emit({ type: "memory", action: "consolidate", count: distilled });
      }
    } finally {
      if (registry) {
        await registry.closeAll();
        this.registries.delete(registry);
      }
    }

    // Trilha de auditoria desta tarefa.
    for (const entry of this.auditTrail.entries().slice(auditBefore)) {
      emit({ type: "audit", entry });
    }

    // Custo da sessão.
    const { usage, cost } = meter.totals();
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      emit({
        type: "cost",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        usd: online ? cost.total : null,
      });
    }

    return outcome;
  }

  private async runChat(
    emit: Emit,
    provider: Provider,
    model: string,
    contextBlock: string,
    prompt: string,
    modeSystem: string,
    history: TaskRequest["history"] = [],
  ): Promise<TaskOutcome> {
    const system = contextBlock ? `${modeSystem}\n\n${contextBlock}` : modeSystem;
    for await (const chunk of provider.chat({
      messages: [...(history ?? []), { role: "user", content: prompt }],
      model,
      system,
      cache: !!contextBlock,
    })) {
      if (chunk.text) emit({ type: "token", text: chunk.text });
    }
    return { state: "Respondido" };
  }

  private async runEdit(
    emit: Emit,
    provider: Provider,
    model: string,
    root: string,
    contextBlock: string,
    prompt: string,
    modeSystem: string,
    mem: MarkdownMemory | null,
  ): Promise<TaskOutcome> {
    emit({ type: "info", message: "gerando edição..." });
    const system = contextBlock ? `${modeSystem}\n\n${contextBlock}` : modeSystem;
    let response = "";
    for await (const chunk of provider.chat({
      messages: [{ role: "user", content: `# Tarefa\n${prompt}` }],
      model,
      maxTokens: 4096,
      system,
      cache: !!contextBlock,
    })) {
      response += chunk.text;
    }

    const edits = parseEdits(response);
    if (edits.length === 0) {
      emit({ type: "info", message: "nenhuma edição proposta (sem blocos SEARCH/REPLACE)" });
      return { state: "SemEdicoes" };
    }

    const plans = await planEdits(root, edits);
    emit({ type: "plan", plans, attempt: 1 });
    const ok = plans.filter((p) => p.status !== "error");
    if (ok.length === 0) {
      return { state: "Rejeitado", attempts: 1, reason: "todos os blocos de edição falharam no plano" };
    }

    const target = ok.map((p) => p.file).join(", ");
    const approved = await this.host.approve({ action: "apply", target, attempt: 1 });
    this.auditTrail.record({
      author: "user",
      action: "apply",
      target,
      result: approved ? "approved" : "denied",
    });
    if (!approved) {
      emit({ type: "info", message: "cancelado, nada foi escrito" });
      return { state: "Cancelado" };
    }

    const written = await writePlan(root, ok);
    emit({ type: "info", message: `aplicado em: ${written.join(", ")}` });
    if (mem) {
      await recordEpisode(mem, { task: prompt, detail: `Aplicado em: ${written.join(", ")} (sem selo)`, verified: false });
      emit({ type: "memory", action: "record", count: 1 });
    }
    return { state: "Aplicado", files: written };
  }

  private async runEditLoop(
    emit: Emit,
    provider: Provider,
    model: string,
    root: string,
    contextBlock: string,
    prompt: string,
    modeSystem: string,
    testCommand: string | string[],
    attempts: number,
    approval: ApprovalPolicy,
    mem: MarkdownMemory | null,
    skillStore: VerifiedSkillStore | null,
  ): Promise<TaskOutcome> {
    const gate = new ApprovalGate(approval, (req) => this.host.approve(req), this.auditTrail);
    const outcome = await runEditLoop(contextBlock, prompt, {
      provider,
      model,
      root,
      testCommand,
      maxAttempts: attempts,
      system: modeSystem,
      audit: this.auditTrail,
      beforeSeal: async (info: AttemptInfo) => {
        emit({ type: "plan", plans: info.plans, attempt: info.attempt });
        if (!info.plans.some((p) => p.status !== "error")) return false;
        const target = info.plans.map((p) => p.file).join(", ");
        emit({ type: "approval", request: { action: "seal", target, attempt: info.attempt } });
        return gate.approve({ action: "seal", target, attempt: info.attempt });
      },
      afterSeal: (info, result: SealResult) => {
        emit({
          type: "seal",
          state: result.state,
          attempt: info.attempt,
          ...(result.state === "Rejeitado" ? { reason: result.reason } : {}),
        });
      },
    });

    switch (outcome.state) {
      case "Verificado":
        if (mem) {
          await recordEpisode(mem, {
            task: prompt,
            detail: `Selado (suíte passou) em ${outcome.attempts} tentativa(s).`,
            verified: true,
          });
          emit({ type: "memory", action: "record", count: 1 });
        }
        if (skillStore) {
          const sealed = await induceAndSeal(skillStore, { task: prompt, result: outcome.result });
          if (sealed) emit({ type: "info", message: "skill induzida e selada" });
        }
        return { state: "Verificado", attempts: outcome.attempts };
      case "Rejeitado":
        return {
          state: "Rejeitado",
          attempts: outcome.attempts,
          reason: outcome.result.state === "Rejeitado" ? outcome.result.reason : "rejeitado",
        };
      case "SemEdicoes":
        return { state: "SemEdicoes" };
      case "Cancelado":
        return { state: "Cancelado" };
    }
  }

  private async runToolUse(
    emit: Emit,
    provider: Provider,
    model: string,
    contextBlock: string,
    prompt: string,
    modeSystem: string,
    executor: ToolExecutor,
    history: TaskRequest["history"] = [],
  ): Promise<TaskOutcome> {
    // Injeta as docs de capacidade (reach + browser) conforme as tools expostas: olhos
    // na internet e/ou navegador real + metodologia/regras de HITL. Vazio quando ausentes.
    const exposed = executor.tools();
    const skills = [reachSkillSection(exposed), browserSkillSection(exposed), memorySkillSection(exposed)]
      .filter(Boolean)
      .join("\n\n");
    const system = [modeSystem, skills, contextBlock].filter(Boolean).join("\n\n");
    emit({ type: "info", message: "tool-use: o agente pode chamar ferramentas MCP" });
    const result = await runToolLoop(prompt, {
      provider,
      model,
      system,
      executor,
      maxTurns: this.config.maxTurns ?? 30,
      ...(history && history.length ? { history } : {}),
      onToolCall: (call, res) => {
        emit({ type: "tool.call", name: call.name, args: call.arguments });
        emit({ type: "tool.result", name: call.name, ok: !res.startsWith("ERRO:"), preview: res.slice(0, 200) });
      },
    });
    if (result.text) emit({ type: "token", text: result.text });
    emit({ type: "info", message: `tool-use: ${result.calls.length} chamada(s) em ${result.turns} volta(s)` });
    return { state: "Respondido" };
  }

  // ---- Primitivas granulares (o Typer Core Server consome estas) ----

  async retrieve(query: string, files: string[] = []): Promise<string> {
    const local = this.config.local ?? false;
    const grep = this.config.grep ?? true;
    if (this.config.features?.semantic) {
      const { embedder } = await pickEngineEmbedder(local);
      const res = await buildHybridContext({ root: this.config.root, files, grep, query, embedder });
      return res.block;
    }
    const res = await buildRipgrepContext(this.config.root, files, grep, query);
    return res.block;
  }

  async plan(prompt: string, files: string[] = []): Promise<{ plans: FilePlan[]; raw: string }> {
    const ctx = await buildRipgrepContext(this.config.root, files, true, prompt);
    const { provider, model } = await buildEngineProvider({
      local: this.config.local ?? false,
      provider: this.config.provider ?? null,
      model: this.config.model ?? null,
      task: "agent",
    });
    const system = ctx.block ? `${EDIT_SYSTEM_INSTRUCTION}\n\n${ctx.block}` : EDIT_SYSTEM_INSTRUCTION;
    let raw = "";
    for await (const chunk of provider.chat({
      messages: [{ role: "user", content: `# Tarefa\n${prompt}` }],
      model,
      maxTokens: 4096,
      system,
      cache: !!ctx.block,
    })) {
      raw += chunk.text;
    }
    const plans = await planEdits(this.config.root, parseEdits(raw));
    return { plans, raw };
  }

  async verify(plans: FilePlan[]): Promise<SealResult> {
    if (this.config.testCommand === undefined) {
      throw new Error("verify requer testCommand na EngineConfig");
    }
    const router = new SealRouter({ root: this.config.root, testCommand: this.config.testCommand });
    return router.verifyCode(plans);
  }

  /** Monta as dependências do executor de ferramentas (broker + policy gate + selo).
   *  Reusado por callTool (origin user) e pelo loop de agente (origin agent). */
  private async buildToolDeps(opts: {
    origin: "user" | "agent";
    onPolicy?: (n: PolicyNotice) => void;
    embedder?: Embedder | null;
  }): Promise<ToolCallDeps> {
    const grant = this.config.capabilities ?? defaultGrantFor(this.config.surface);
    const approval = this.config.approval ?? "first-only";
    const policy = await loadPolicy(this.config.root);
    // sealGated tools precisam de um verificador; sem testCommand, "true" passa
    // trivialmente (a maioria das chamadas diretas é de leitura). A Fase 3 endurece.
    const sealRouter = new SealRouter({ root: this.config.root, testCommand: this.config.testCommand ?? "true" });
    const testCommandStr =
      this.config.testCommand === undefined
        ? undefined
        : typeof this.config.testCommand === "string"
          ? this.config.testCommand
          : this.config.testCommand.join(" ");
    return {
      root: this.config.root,
      grant,
      sealRouter,
      origin: opts.origin,
      surface: this.config.surface,
      policy,
      autonomous: isAutonomous(this.config.surface, approval),
      // sandbox real p/ ferramentas exec:microvm (gated pelo broker por superfície)
      microvm: pickSandbox({}),
      approve: (reason) =>
        Promise.resolve(this.host.approve({ action: "tool", target: reason.slice(0, 48), detail: reason, attempt: 1 })),
      audit: (e) =>
        this.auditTrail.record({
          author: e.origin === "user" ? "user" : "agent",
          action: e.tool,
          target: JSON.stringify(e.args).slice(0, 120),
          result: e.result,
        }),
      ...(opts.onPolicy ? { onPolicy: opts.onPolicy } : {}),
      ...(this.config.local !== undefined ? { local: this.config.local } : {}),
      ...(testCommandStr !== undefined ? { testCommand: testCommandStr } : {}),
      // super-assistente: navegador, cofre e o canal de perguntas (browser_*/vault_*/ask_user)
      ...(this.config.browser !== undefined ? { browser: this.config.browser } : {}),
      ...(this.config.vault !== undefined ? { vault: this.config.vault } : {}),
      ...(this.config.ask !== undefined ? { ask: this.config.ask } : {}),
      // memória: o MESMO embedder do recall, p/ escrita (memory_write) e leitura casarem
      ...(opts.embedder ? { embedder: opts.embedder } : {}),
    };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const deps = await this.buildToolDeps({ origin: "user" });
    const result = await callRegistryTool(name, args, deps);
    if (!result.ok) {
      throw new Error(result.error?.message ?? "erro desconhecido na ferramenta");
    }
    return result.value;
  }

  async handoff(): Promise<Handoff | null> {
    return loadHandoff(this.config.root);
  }

  audit(): readonly AuditEntry[] {
    return this.auditTrail.entries();
  }

  async dispose(): Promise<void> {
    for (const reg of this.registries) await reg.closeAll();
    this.registries.clear();
  }
}

export function createEngine(config: EngineConfig, host: EngineHost): Engine {
  return new EngineImpl(config, host);
}
