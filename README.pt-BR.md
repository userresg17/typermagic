<!-- [English](./README.md) | 🌐 Português -->

<p align="center">
  <img src="./logoagente.svg" alt="TYPER Magic" width="120" />
</p>

<h1 align="center">TYPER Magic</h1>

<p align="center"><em>O agente em que você confia código e dado de verdade — porque ele prova antes de agir.</em></p>

---

O TYPER Magic é um **agente de código local-first, BYOK e agnóstico de modelo**, construído
em torno de uma regra dura: **toda ação com efeito real passa por um portão de verificação
antes de acontecer.** Ele iguala o alcance e a auto-melhoria dos agentes populares de
codificação e auto-melhoria, e põe os dois atrás de um **selo** — o portão de escrita que
começa *rejeitado* e só vira *verificado* quando a suíte de testes do projeto passa.

> A maioria dos agentes ganha em alcance e autonomia e deixa a mesma ferida aberta: não
> conseguem dizer "essa ação é segura antes de eu executar", e uma skill de terceiro pode
> exfiltrar seu dado sem você perceber. O TYPER Magic fecha essa classe de problema por
> construção.

## Por que é diferente

- **O selo — generalizado.** Mudanças de código são gateadas pela sua suíte de testes
  (nada vai ao disco sem passar, e reverte sozinho na falha). Ações de efeito externo são
  gateadas por política + dry-run, e as irreversíveis pedem um selo humano.
- **Menor privilégio por superfície.** Cada uma das 50 ferramentas carrega uma `permission`
  (`read`/`write`/`exec`/`network`/`meta`) e um contexto de `exec`
  (`in_process`/`subprocess`/`microvm`). Um **broker de capacidade** casa cada ferramenta
  com o grant da superfície *antes* do dispatch — confiança total no seu terminal,
  default-deny para o que vem de fora.
- **Defesa de prompt injection.** Conteúdo não confiável (páginas web, arquivos, saída de
  ferramenta) nunca entra no canal de instrução — é dado a processar, nunca ordem a obedecer.
- **Memória estilo Obsidian, mais leve.** Um vault markdown file-based com wikilinks
  `[[ ]]`, backlinks automáticos, tags, um grafo navegável e recall híbrido (semântico +
  caminhada no grafo + léxico). Cada entrada carrega procedência e confiança; o recall
  prefere o que é verificado.
- **Um motor, várias superfícies.** Uma **Engine API** estável move uma CLI/TUI standalone,
  um editor de código e (no roadmap) gateways de mensagem e um scheduler — todos falando a
  mesma fachada.

## Arquitetura

```
Superfícies:  CLI/TUI ──┐   Editor ──┐   [Gateway/Scheduler — roadmap]
                        ▼            ▼
                 Engine API  (@typer/engine)  ← fachada estável
                        │  runTask() em stream de eventos + primitivas
                        ▼
   Núcleo:  router · retrieval · index · memory · handoff · skills · selo · agent (50 tools) · mcp · cost
                        │
        Espinha de segurança: broker de capacidade · selo por classe de ação
```

O núcleo nunca sabe qual modelo está atrás nem qual superfície está na frente. Trocar de
modelo é trocar um adaptador, não a arquitetura.

## Começo rápido

```bash
pnpm install
# offline (sem chave) cai num provider Fake determinístico
pnpm --filter @typer/agent-cli dev chat "o que faz o router?"
pnpm --filter @typer/agent-cli dev tools            # as 50 ferramentas, com permissão/exec
pnpm --filter @typer/agent-cli dev memory           # o grafo de memória (ascii)
pnpm --filter @typer/agent-cli dev                  # REPL interativo

# traga sua própria chave
typer-agent auth set anthropic                      # ou export TYPER_ANTHROPIC_KEY=...
typer-agent run --test "pnpm test" "corrija o bug em src/x.ts"
```

## Estado

A fundação está de pé e testada: a Engine API, a CLI/TUI standalone, a memória estilo
Obsidian com visualização em grafo, e a espinha de segurança (broker de capacidade +
selo). No roadmap: enforcement do broker para efeitos externos, gateways de mensagem
(capability-scoped, um canal por vez), um registry de skill assinado com capability diff na
importação, serverless + scheduler, e export de trajetória assinada.

## Licença

[Apache-2.0](./LICENSE). Os comentários do código são em português do Brasil — um
invariante do projeto.
