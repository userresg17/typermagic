<!-- 🌐 English | [Português](./README.pt-BR.md) -->

<p align="center">
  <img src="./logoagente.svg" alt="TYPER Magic" width="120" />
</p>

<h1 align="center">TYPER Magic</h1>

<p align="center"><em>The general-purpose agent you trust with real systems and real data — because it proves before it acts.</em></p>

---

TYPER Magic is a **local-first, BYOK, model-agnostic agent** in the class of Hermes and
OpenClaw — a **general-purpose autonomous agent**, not a code-only tool. It operates real
systems and real data: it writes and ships code, runs and supervises commands, browses the
web, automates and watches over your servers, reasons over your files, and improves itself
from signed skills. You drive it from a terminal, an editor, a chat (Telegram), or on a
schedule. Writing code is one of the things it does — not the whole of what it is.

It's built around one hard rule: **every action with a real-world effect passes a
verification gate before it happens.** It matches the reach, autonomy and self-improvement
of the popular agents — and puts all of it behind a **seal**: code changes flip from
*rejected* to *verified* only when your test suite passes, and an irreversible external
action never runs on its own.

> Most agents win on reach and autonomy and leave the same wound open: they can't say
> "this action is safe before I run it," and a third-party skill can exfiltrate your data
> without you noticing. TYPER Magic closes that class of problem by construction.

## Why it's different

- **General-purpose, not code-only.** The same agent writes code, runs and supervises
  commands, browses, monitors and fixes a server over chat, runs scheduled jobs, and recalls
  from its memory vault. Code is one surface of a system that operates whatever you grant it.
- **The seal — generalized.** Code changes are gated by your test suite (nothing hits
  disk unless it passes, and it auto-reverts on failure). External-effect actions are
  gated by policy + dry-run, and irreversible ones require a human seal — or, on an
  autonomous surface (scheduler, gateway), they **escalate instead of executing**.
- **Least privilege by surface.** Every one of the 50 agent tools carries a `permission`
  (`read`/`write`/`exec`/`network`/`meta`) and an `exec` context
  (`in_process`/`subprocess`/`microvm`). A **capability broker** matches each tool against
  the surface's grant *before* dispatch — full trust for your terminal, default-deny for
  anything coming from a chat, a schedule, or an imported skill.
- **Prompt-injection defense.** Untrusted content (web pages, files, tool output) never
  enters the instruction channel — it's data to process, never an order to obey.
- **Signed everything.** Skills carry an Ed25519 signature and a capability manifest;
  importing one shows a capability **diff**, quarantines it, and runs it confined — an
  unsigned or tampered skill never loads. Runs export as **signed, reproducible
  trajectories** you can verify and turn into training data.
- **Obsidian-style memory, lighter.** A file-based markdown vault with wikilinks `[[ ]]`,
  automatic backlinks, tags, a navigable graph and a hybrid recall (semantic + graph walk
  + lexical). Each entry carries provenance and confidence; recall prefers what's verified.
- **One engine, many surfaces.** A stable **Engine API** drives a standalone CLI/TUI, a
  code editor, a **messaging gateway** (Telegram, capability-scoped per sender), a
  **scheduler/daemon**, and a **serverless handler** — all speaking the same façade.

## Architecture

```
Surfaces:  CLI/TUI ─┐  Editor ─┐  Gateway (Telegram) ─┐  Scheduler ─┐  Serverless ─┐
                    ▼          ▼                       ▼            ▼              ▼
                        Engine API  (@typer/engine)  ← stable façade
                            │  runTask() event stream + primitives (retrieve/plan/verify/callTool)
                            ▼
   Core:  router · retrieval · index · memory · handoff · skills · seal · agent (50 tools)
          crypto · sandbox · trajectory · mcp · cost
                            │
       Security spine: capability broker · policy gate (external effects)
                        seal by action class · signed skills & trajectories
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

# bring your own key, then put it to work across surfaces
typer-agent auth set anthropic                      # or export TYPER_ANTHROPIC_KEY=...
typer-agent run --test "pnpm test" "fix the bug in src/x.ts"
typer-agent gateway telegram                        # drive it from a chat (TYPER_TELEGRAM_TOKEN)
typer-agent schedule daemon                          # autonomous scheduled tasks (irreversible still gated)
typer-agent trajectory export                        # signed, reproducible run logs → dataset
```

## Status

The foundation **and the autonomy layer** are in place and fully tested (374 tests): the
Engine API, the standalone CLI/TUI, the Obsidian-style memory with graph visualization, the
security spine (capability broker + policy gate for external effects + seal by action
class), real subprocess sandbox isolation (Firecracker opt-in behind a `MicroVm` driver), a
capability-scoped messaging gateway (Telegram, allowlist + rate-limit per sender), a signed
skill registry with capability diff + quarantine + revocation on import, a scheduler daemon
and a serverless handler, and signed, reproducible trajectory export feeding the fine-tune
pipeline. Live channels, microVM isolation and serverless deploy light up with your own
infra (BYO-token / credentials) — they're never required to run or test the core.

## License

[Apache-2.0](./LICENSE). Code comments are in Brazilian Portuguese — a project invariant.
