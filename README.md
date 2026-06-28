<!-- 🌐 English | [Português](./README.pt-BR.md) -->

<p align="center">
  <img src="./logoagente.svg" alt="TYPER Magic" width="120" />
</p>

<h1 align="center">TYPER Magic</h1>

<p align="center"><em>The agent you trust with real code and real data — because it proves before it acts.</em></p>

---

TYPER Magic is a **local-first, BYOK, model-agnostic coding agent** built around one hard
rule: **every action with a real-world effect passes a verification gate before it
happens.** It matches the reach and self-improvement of popular coding and
self-improvement agents, and puts both behind a **seal** — the write gate that starts
*rejected* and only flips to *verified* when the project's test suite passes.

> Most agents win on reach and autonomy and leave the same wound open: they can't say
> "this action is safe before I run it," and a third-party skill can exfiltrate your data
> without you noticing. TYPER Magic closes that class of problem by construction.

## Why it's different

- **The seal — generalized.** Code changes are gated by your test suite (nothing hits
  disk unless it passes, and it auto-reverts on failure). External-effect actions are
  gated by policy + dry-run, and irreversible ones require a human seal.
- **Least privilege by surface.** Every one of the 50 agent tools carries a `permission`
  (`read`/`write`/`exec`/`network`/`meta`) and an `exec` context
  (`in_process`/`subprocess`/`microvm`). A **capability broker** matches each tool against
  the surface's grant *before* dispatch — full trust for your terminal, default-deny for
  anything coming from outside.
- **Prompt-injection defense.** Untrusted content (web pages, files, tool output) never
  enters the instruction channel — it's data to process, never an order to obey.
- **Obsidian-style memory, lighter.** A file-based markdown vault with wikilinks `[[ ]]`,
  automatic backlinks, tags, a navigable graph and a hybrid recall (semantic + graph walk
  + lexical). Each entry carries provenance and confidence; recall prefers what's verified.
- **One engine, many surfaces.** A stable **Engine API** drives a standalone CLI/TUI, a
  code editor, and (on the roadmap) messaging gateways and a scheduler — all speaking the
  same façade.

## Architecture

```
Surfaces:  CLI/TUI ──┐   Editor ──┐   [Gateway/Scheduler — roadmap]
                     ▼            ▼
              Engine API  (@typer/engine)  ← stable façade
                     │  runTask() event stream + primitives (retrieve/plan/verify/callTool)
                     ▼
   Core:  router · retrieval · index · memory · handoff · skills · seal · agent (50 tools) · mcp · cost
                     │
        Security spine: capability broker · seal by action class
```

The core never knows which model is behind it or which surface is in front. Swapping a
model is swapping an adapter, not the architecture.

## Quick start

```bash
pnpm install
# offline (no key) falls back to a deterministic Fake provider
pnpm --filter @typer/agent-cli dev chat "what does the router do?"
pnpm --filter @typer/agent-cli dev tools            # the 50 tools, with permission/exec
pnpm --filter @typer/agent-cli dev memory           # the memory graph (ascii)
pnpm --filter @typer/agent-cli dev                  # interactive REPL

# bring your own key
typer-agent auth set anthropic                      # or export TYPER_ANTHROPIC_KEY=...
typer-agent run --test "pnpm test" "fix the bug in src/x.ts"
```

## Status

The foundation is in place and fully tested: the Engine API, the standalone CLI/TUI, the
Obsidian-style memory with graph visualization, and the security spine (capability broker
+ seal). On the roadmap: live broker enforcement for external effects, messaging gateways
(capability-scoped, one channel at a time), a signed skill registry with capability diff
on import, serverless + scheduler, and signed trajectory export.

## License

[Apache-2.0](./LICENSE). Code comments are in Brazilian Portuguese — a project invariant.
