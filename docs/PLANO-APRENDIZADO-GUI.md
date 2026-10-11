# Plano — Aprendizado de tarefas em programas de desktop (GUI) a partir de tutoriais

> Continuação do porte macOS (`README_MACOS.md`, Fases 0–6). Este documento é o plano
> de execução das Fases 7–12: o agente aprende a operar programas complexos
> (editores de vídeo, imagem, 3D…) **assistindo tutoriais** (vídeo + transcrição),
> destila o que viu numa **skill**, **ensaia** a skill no programa real com
> checkpoints, e só então a guarda na biblioteca verificada. Cada fase tem critério
> de aceite mensurável; nada avança sem a fase anterior verde.
>
> Nenhum dado pessoal, credencial, identificador de conta ou caminho de usuário entra
> neste documento nem no repositório. Configuração local vive em `.env` e
> `.typer/` (ignorados pelo git).

## 0. Princípios (herdados e novos)

1. **API antes de clique, acessibilidade antes de visão.** Programa que expõe API de
   scripting (DaVinci Resolve, Blender, GIMP, Photoshop) é operado pela API sempre que
   ela cobre o passo; GUI por acessibilidade quando não; visão + coordenadas só como
   último recurso. Mesma regra que o agente de desktop já segue.
2. **Skill aprendida de vídeo é hipótese, não conhecimento.** Só entra na biblioteca
   (`core/skills`, selo + assinatura) depois de um **ensaio real** no programa com
   resultado verificado. Isso reaproveita a porta que já existe (`VerifiedSkillStore.seal`).
3. **Intenção, não coordenada.** Cada passo da skill registra *o que* se quer (abrir
   painel X, aplicar LUT Y ao clipe Z), *como* se chega lá (menu, atalho, API) e *como se
   verifica* que deu certo. Coordenadas de tela nunca são persistidas.
4. **Humano no circuito nas mesmas regras de hoje.** Ação irreversível (exportar por
   cima, publicar, apagar) exige confirmação por botão no Telegram; `/parar` e o arquivo
   STOP continuam valendo; checkpoint com screenshot a cada N passos.
5. **Fora de escopo permanece fora.** Nenhum módulo de CAPTCHA/anti-bot/simulação humana
   é instalado, chamado ou alterado. Login em site é `human_handoff`.
6. **Custo controlado.** Modelo de visão caro (Opus) só para planejar e verificar; leitura
   de frames de tutorial e localização de elementos de tela usam modelo mais barato ou
   local (ver Fase 10). Orçamento por tarefa em `.env`.

## 1. Arquitetura alvo (resumo)

```
 tutorial (URL)                                   tarefa do usuário (Telegram)
      │                                                     │
      ▼                                                     ▼
 core/learn ─── ingestão ───▶ SKILL.md candidato      engine → recall de skills
  ├ download (yt-dlp)              (não selado)          │  (embedding, só seladas)
  ├ transcrição (VTT/Whisper)          │                 ▼
  ├ cenas + frames (ffmpeg)            │           desktop/app agent
  ├ descrição por visão (VLM)          │          ├ adaptador de app (API)
  └ destilação (LLM) ─────────────┐    │          ├ AX / atalhos
                                  │    │          └ visão (grounding local)
                                  ▼    ▼                 │
                           ensaio (/ensaiar) ───────────┘
                           checkpoints + verificação
                                  │
                                  ▼ passou
                       selo + assinatura → biblioteca
```

Pacotes novos: `core/learn` (ingestão e destilação), `core/apps` (adaptadores por
programa), `platform/apps/` (pontes Python para APIs nativas, ex.: Resolve). Pacotes
tocados: `core/skills` (formato GUI, estado `candidate`), `core/agent` (ferramentas
`learn_*`, `app_*`, grounding), `app/gateway` (comandos `/aprender`, `/ensaiar`,
`/skills`), `app/agent-cli` (comando `learn`), `scripts/doctor.py`, `README_MACOS.md`.

## 2. Fases

### Fase 7 — Ingestão de tutorial → skill candidata

**Objetivo:** dado um link de vídeo, produzir um `SKILL.md` candidato, legível e
rastreável até os trechos do vídeo, sem nenhuma execução no programa.

| # | Subfase | Entrega | Verificação |
|---|---------|---------|-------------|
| 7.1 | Dependências | `yt-dlp` e `ffmpeg` checados pelo `doctor.py`; pasta de trabalho `~/.typer/learn/<id>/` | `pnpm doctor` lista os dois binários |
| 7.2 | Download | `core/learn/download.ts`: vídeo ≤720p, legendas (manual > automática), `info.json`; um idioma por vez para não tomar 429 | teste com URL fixa; arquivos presentes; metadados (título, duração, canal, licença) extraídos |
| 7.3 | Transcrição | `core/learn/transcript.ts`: VTT → segmentos `{start,end,text}` com de-duplicação do rolling text do YouTube; fallback Whisper local (sherpa-onnx já instalado) quando não há legenda | teste unitário com VTT real; cobertura ≥ 95% da duração; sem segmentos repetidos |
| 7.4 | Cenas e frames | `core/learn/scenes.ts`: ffmpeg `scene` + amostragem periódica (gap máx. 6 s), teto de frames (padrão 150), JPEG 1280px, hash perceptual para descartar quase-iguais | teste em vídeo de 12 min gera 80–150 frames, nenhum par consecutivo idêntico |
| 7.5 | Descrição por visão | `core/learn/describe.ts`: lotes de 4–6 frames + fala do intervalo → JSON por frame `{t, app, panel, action, ui_elements[], shortcut?}`; modelo configurável (`TYPER_LEARN_MODEL`, padrão modelo médio) | saída válida contra schema; custo por tutorial de 12 min registrado em log |
| 7.6 | Destilação | `core/learn/distill.ts`: transcrição + descrições → procedimento em passos (intenção, como, verificação, armadilhas), pré-requisitos, versão do programa observada, fontes `[t=mm:ss]` | revisão humana de 2 tutoriais: passos coerentes com o vídeo; nenhum passo sem fonte |
| 7.7 | Formato de skill GUI | `core/skills`: campos `kind: "gui"`, `app`, `appVersion`, `steps[]`, `sources[]`, `state: "candidate" \| "sealed"`; `parseSkill/serializeSkill` compatíveis com skills antigas | testes existentes de skills passam; novo teste round-trip do formato GUI |
| 7.8 | Superfície para pessoa | Telegram `/aprender <url>` (progresso em mensagens, SKILL.md resumido ao fim), CLI `typer-agent learn <url>`, `/skills` lista candidatas e seladas | fluxo completo pelo Telegram sem tocar no terminal |

**Aceite da Fase 7:** dois tutoriais distintos do mesmo programa viram duas skills
candidatas pelo Telegram; cada passo cita o instante do vídeo; custo e tempo por
tutorial documentados.

### Fase 8 — Ensaio e selo

**Objetivo:** executar a skill candidata no programa real, sob supervisão, e só
promover à biblioteca o que funcionou.

| # | Subfase | Entrega | Verificação |
|---|---------|---------|-------------|
| 8.1 | Plano de ensaio | A partir da skill, gerar roteiro: pré-condições (programa instalado, projeto/mídia de teste), passos, critério final observável (arquivo exportado, estado da timeline…) | roteiro impresso no Telegram antes de começar |
| 8.2 | Executor de ensaio | `core/agent/learn/rehearse.ts`: roda passo a passo com o agente de desktop/app, checkpoint (screenshot) por passo, verificação por passo (AX/API/visão), replanejamento local em falha (até N tentativas) | ensaio de skill simples termina com veredito `passou/falhou` e trilha em `steps.jsonl` |
| 8.3 | Verificação final | Critério objetivo: arquivo existe e tem duração/resolução esperada (ffprobe), estado da API bate, ou comparação de screenshot com referência | teste com saída forjada falha; saída real passa |
| 8.4 | Selo | Ensaio aprovado → `SealResult` Verificado → `store.seal()` (assinatura, embedding, `state: sealed`); falha → skill fica candidata com `lastRehearsal` e motivo | só skills seladas aparecem no recall da engine |
| 8.5 | Superfície | Telegram `/ensaiar <skill>` com botões confirmar/cancelar, `/skills` mostra estado e último ensaio | pessoa consegue ensaiar e ver o resultado sem terminal |

**Aceite da Fase 8:** uma skill aprendida de vídeo foi ensaiada, passou e está selada;
uma segunda falhou de propósito (pré-condição ausente) e **não** entrou na biblioteca.

### Fase 9 — Adaptador do programa alvo (DaVinci Resolve) e tarefa fim a fim

**Objetivo:** primeira tarefa real completa: importar vídeo, cortes pontuais, ajuste de
cor, exportar, enviar ao YouTube **sem publicar** (privado).

| # | Subfase | Entrega | Verificação |
|---|---------|---------|-------------|
| 9.1 | Ponte de scripting | `platform/apps/resolve.py`: módulo `fusionscript` da instalação, JSON-lines como o sidecar macOS; ops `project.open/create`, `media.import`, `timeline.create`, `clip.cut/trim/delete`, `color.apply_lut/cdl`, `render.add_job/start/wait` | cada op testada contra Resolve aberto com projeto de teste |
| 9.2 | Pré-requisito de scripting | Detectar se "External scripting" está em Local; se não, instruir a pessoa (ou fazer via acessibilidade com confirmação) | `doctor.py` reporta estado |
| 9.3 | Adaptador TS | `core/apps/resolve.ts` implementa interface `AppAdapter { capabilities(), run(op) }`; ferramenta `app_resolve` para o agente; fallback GUI quando a API não cobre (ex.: certos painéis de cor) | testes unitários com ponte falsa; E2E com Resolve |
| 9.4 | Mídia de teste | Clipe curto com licença permissiva (Creative Commons / domínio público) baixado por `yt-dlp`, com a licença registrada no `info.json` | arquivo + licença documentados em `.typer/learn/media/` |
| 9.5 | Tarefa fim a fim | Pelo Telegram: "edite o vídeo X: cortes em …, cor mais quente, exporte 1080p" → skills seladas + adaptador → arquivo exportado; checkpoints com screenshot | `ffprobe` do export: resolução, duração e codec esperados; screenshot do antes/depois da cor |
| 9.6 | Envio ao YouTube privado | Opção A (preferida): YouTube Data API com OAuth do próprio usuário, `privacyStatus: private`; opção B: navegador real (Brave CDP) no YouTube Studio com `human_handoff` para login. Nunca publicar: confirmação por botão mostra título e visibilidade | vídeo aparece como **Privado** na conta; nenhuma publicação |

**Aceite da Fase 9:** a tarefa completa roda a partir de uma mensagem no Telegram, com
confirmação antes do envio, e termina com link do vídeo privado + screenshot.

### Fase 10 — Percepção rápida e barata (grounding local)

**Objetivo:** reduzir tempo e custo por passo em tarefas longas (50–150 passos).

| # | Subfase | Entrega | Verificação |
|---|---------|---------|-------------|
| 10.1 | Medição | Instrumentar `steps.jsonl` com tempo por etapa (screenshot, AX, LLM, ação) e tokens | relatório de onde vai o tempo nos ensaios da Fase 8/9 |
| 10.2 | Grounding local | Modelo de localização de elementos de UI rodando na GPU (Metal) como serviço local: entrada screenshot + descrição textual, saída caixa/centro. Avaliar candidatos abertos; escolher pelo acerto em 50 capturas rotuladas do programa alvo | acerto ≥ 90% no conjunto rotulado; latência < 1 s por consulta |
| 10.3 | Integração | Agente de desktop: AX → grounding local → visão do modelo grande (só quando os dois falham) | passos por minuto ≥ 3× o baseline da 10.1 |
| 10.4 | Planejamento hierárquico | Tarefa longa vira sub-metas com verificação própria; falha replaneja a sub-meta, não a tarefa inteira | tarefa de 50 passos termina sem intervenção em ≥ 4 de 5 rodadas |

### Fase 11 — Generalização para outros programas

Para cada programa novo: adaptador (`core/apps/<app>.ts` + ponte se houver API),
2 tutoriais ingeridos, 1 tarefa fim a fim selada. Ordem sugerida, pelo esforço:
GIMP (Python-Fu), Blender (bpy), Shotcut/Kdenlive (GUI + MLT), Audacity (mod-script-pipe),
Photoshop (UXP/AppleScript), CapCut desktop (só GUI). Programas pagos ficam para quando
houver licença instalada; nada neste plano depende deles.

### Fase 12 — Autonomia e operação contínua

| # | Subfase | Entrega |
|---|---------|---------|
| 12.1 | Agenda | `app/scheduler` dispara tarefas recorrentes (ex.: cortar e subir privado toda noite) com as mesmas confirmações |
| 12.2 | Observabilidade | `/status` mostra skills, ensaios, custo do dia; log JSONL rotacionado já existente ganha os eventos de aprendizado |
| 12.3 | Evolução de skill | Ensaio que falha em skill selada rebaixa para candidata e abre re-destilação com o erro; versão da skill incrementa |
| 12.4 | 24/7 | Comandos de energia/login automático continuam listados em `README_MACOS.md` e só são aplicados com autorização explícita |

## 3. Critérios transversais de "pronto"

- Testes automatizados verdes com saída colada no relatório da fase.
- Fluxo completo acionável por uma pessoa pelo Telegram (sem terminal).
- Sem regressão: suíte existente continua passando; `pnpm doctor` verde.
- Nenhum segredo, identificador pessoal ou caminho de usuário em commit.
- Cada fase fecha com commit pequeno e push.

## 4. Riscos conhecidos

| Risco | Mitigação |
|-------|-----------|
| Tutorial em versão/idioma diferente do programa instalado | Skill registra `appVersion` observada; ensaio detecta divergência e replaneja por intenção, não por posição |
| Canvas/timeline sem acessibilidade | API do programa primeiro; grounding local (Fase 10) depois; visão do modelo grande por último |
| Custo de visão por frame | Teto de frames, modelo médio para descrição, cache por hash de frame |
| 429 do YouTube ao baixar legendas | Uma língua por vez, espera entre pedidos, cache local |
| Skill errada entrar na biblioteca | Nunca sem ensaio aprovado; revogação por hash já existe |
| Envio ao YouTube virar publicação | `privacyStatus` fixo em privado; confirmação por botão exibe visibilidade; nenhuma ação de "publicar" implementada |
