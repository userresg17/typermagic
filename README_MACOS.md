# TYPER Magic no macOS (Apple Silicon) — instalação, permissões e operação

Branch `macos-port`. O que foi feito, como instalar, como rodar como serviço e o que ficou de fora.

## O que muda em relação ao Linux
| Linux (original) | macOS (esta branch) |
|---|---|
| systemd user unit | LaunchAgent `com.typermagic.gateway` (KeepAlive, logs em `~/Library/Logs/typermagic`) |
| `EnvironmentFile` | `scripts/env.sh` carrega o `.env` antes do `node` |
| Chromium Playwright + stealth + xdotool | Brave/Chrome **real** num **perfil dedicado** via CDP, **sem stealth** (`core/agent/src/tools/cdp-browser.ts`) |
| sem controle de desktop | `Platform` + sidecar Python/pyobjc (`platform/macos/`): screenshot, mouse/teclado (CGEvent), acessibilidade (AX), `osascript` |
| CAPTCHA/anti-bot "resolvido" pelo agente | `handoff(reason, screenshot)`: pausa, avisa no Telegram com foto, retoma no **ok** |
| confirmação por texto | botões inline ✅/🚫 com cartão (ação, valor, vendedor/destinatário, endereço, site) |

## Instalação (um comando, idempotente)
```bash
git clone https://github.com/userresg17/typermagic && cd typermagic && git checkout macos-port
scripts/install_macos.sh          # brew deps → pnpm build → venv pyobjc → .env → gateway.json → LaunchAgent → doctor
```
Na 1ª vez ele cria o `.env` e para: preencha **3 linhas** e rode de novo:
```
TYPER_TELEGRAM_TOKEN=   # @BotFather
TYPER_TELEGRAM_ALLOW=   # seu id numérico (fale com @userinfobot) — só ele é atendido
TYPER_ANTHROPIC_KEY=    # ou `typermagic login anthropic` (OAuth)
```
Outras variáveis (todas documentadas em `.env.example`): apps permitidos, hosts de checkout, tetos de gasto, display, resolução lógica, arquivo STOP, log JSONL.

### Permissões do macOS (TCC) — só você concede
O agente precisa de **Gravação de Tela** (screenshot) e **Acessibilidade** (mouse/teclado/árvore AX).
O macOS atribui a permissão ao **binário responsável** — o python do venv:
```
~/.local/share/uv/python/cpython-3.13.*/bin/python3.13     (o doctor imprime o caminho exato)
```
Ajustes do Sistema › Privacidade e Segurança › **Gravação de Tela e Áudio do Sistema** › (+) › `Cmd+Shift+G` › cole o caminho.
Idem em **Acessibilidade**. Depois: `scripts/install_macos.sh --restart`. Se for testar no terminal, o app do terminal
também precisa das duas. `pnpm doctor` mostra o estado.

> Por que não um `.app` assinado: exigiria certificado de desenvolvedor; o binário do venv é estável
> (o `uv` fixa a versão) e cumpre o requisito de "binário estável". Trocar a versão do Python = re-autorizar.
>
> Como a permissão chega ao serviço: o LaunchAgent roda `bash → node → python`, e o macOS cobraria a
> permissão do **bash** (1º processo do job). O sidecar se relança com `responsibility_spawnattrs_setdisclaim`
> (`platform/macos/server.py`), passando a responder pelo **próprio binário** do python — é ele que você
> autoriza. Medido: sem isso o screenshot falhava no serviço mesmo com a permissão concedida.

### ⚠️ Enquanto o agente opera, não use o Mac
Teclado e mouse automatizados vão para **o app que estiver na frente**. O sidecar recusa qualquer tecla/clique
se o app em foco não for o esperado (`expect_app`, rechecado logo antes de postar), mas um clique seu no meio
de uma ação ainda pode interferir. Em uso dedicado 24/7 isso não acontece; em um Mac de trabalho, deixe o
agente terminar (`/parar` aborta na hora).

## Rodar
```bash
pnpm doctor                                   # tudo verde?
scripts/env.sh node app/agent-cli/dist/main.js gateway telegram   # em primeiro plano
scripts/install_macos.sh --restart            # (re)inicia o LaunchAgent
tail -f ~/Library/Logs/typermagic/gateway.err.log                   # log ao vivo
tail -f ~/Library/Logs/typermagic/steps.jsonl                       # log estruturado por passo
```
No Telegram: `/status`, `/help`, `/parar` (kill switch), `/continuar` (remove o arquivo STOP), `/setup` (cofre).
Tarefas: *"abra o TextEdit e escreva 'olá'"* (desktop) · *"abra example.com e me diga o título"* (navegador).

## Voz (ligada)
`brew install ffmpeg` + `pnpm voice:setup` baixam os modelos locais em `~/.typer/voice` (Whisper base p/ ouvir,
Piper pt-BR p/ falar) e `"voice": {"in": true, "out": true}` no `.typer/gateway.json` liga os dois no
gateway. Tudo roda na CPU do Mac, nada sai da máquina. Mande um áudio no Telegram: o bot responde
`🎙️ ouvi: "…"`, executa e devolve a resposta em áudio com o texto na legenda. Medido: síntese ~1,4 s,
transcrição ~0,5 s. Pedido por texto é respondido por texto.

## Testes
```bash
pnpm test                                      # 73 arquivos (núcleo + macOS), vitest
.venv/bin/python -m pytest platform/macos/tests # geometria Retina (puro)
.venv/bin/python scripts/test_macos_platform.py # Fase 2: TextEdit digita, AX, screenshot, Retina (exige TCC)
scripts/env.sh node scripts/test_browser.mjs    # Fase 3: Brave CDP, título, estado, screenshot
TYPER_ALLOWED_APPS=TextEdit scripts/env.sh node scripts/test_desktop_agent.mjs  # sub-agente de desktop real (LLM roteirizado)
TYPER_TEST_MOUSE=1 pnpm vitest run core/agent/test/platform-macos.test.ts  # move o cursor real
```

## Segurança (o que está ligado por padrão)
- **Allowlist de Telegram** (`TYPER_TELEGRAM_ALLOW`), default-deny; `/parar` só de remetente autorizado.
- **Permissão `desktop`** separada no broker: só quem está no `grants` controla o Mac.
- **Allowlist de apps** (`TYPER_ALLOWED_APPS`) e de **hosts de checkout** (`TYPER_CHECKOUT_ALLOW_HOSTS`): vazio = bloqueado.
- **Tetos de gasto** `TYPER_MAX_PER_TX`/`TYPER_MAX_PER_DAY` (BRL): `0` = nenhum pagamento; ledger em `~/.typer/spend.json`.
- Cartão/senha só pelo **cofre** (`vault_fill`) — o modelo nunca vê o valor; no desktop não há cofre → `handoff`.
- **Kill switch**: `/parar` (AbortController até os sub-agentes) e arquivo `~/.typer/STOP`.
- **Texto de tela/página é DADO**: o objetivo só muda por mensagem sua no Telegram.
- **Log JSONL** `~/Library/Logs/typermagic/steps.jsonl` (ação, alvo, hash do screenshot, resultado), rotação por tamanho.
- Perfil do navegador **dedicado** (`~/.typer/browser/cdp-profile`); o seu perfil pessoal é recusado.

## Uso dedicado 24/7 (comandos — NÃO aplicados pelo instalador; peça antes)
```bash
# impedir sleep com a tampa aberta / em energia (precisa de sudo):
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 womp 1 autorestart 1
# alternativa sem sudo, por sessão: caffeinate mantém o sistema acordado enquanto roda
caffeinate -dimsu &
# login automático (Ajustes › Usuários e Grupos › Login automático) e NÃO bloquear a tela:
sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser -string "$USER"
defaults write com.apple.screensaver idleTime -int 0
# display: sem monitor, use um dongle HDMI dummy (o CGEvent/AX exigem sessão gráfica ativa).
```

## Depuração
- Sidecar manual: `echo '{"id":1,"op":"screen_size"}' | .venv/bin/python platform/macos/server.py`
- Navegador CDP: `curl http://127.0.0.1:9222/json/version`
- `desktop_unavailable` → `desktop: true` no `.typer/gateway.json` e `"desktop"` nas permissions do grant.
- Árvore AX vazia / teclado não digita → Accessibility não concedido ao python do venv.
- `screencapture falhou` / imagem só com wallpaper → Gravação de Tela não concedida.

## Limitações conhecidas
- Sem stealth, sites com anti-bot detectam automação mais vezes → mais `handoff` (decisão de escopo).
- Sandbox de código (`sandbox_exec`) no macOS cai no modo fraco (sem bwrap/unshare).
- Voz (ASR/TTS) é opt-in e precisa de `brew install ffmpeg`.
- Multi-monitor: só o display configurado (`TYPER_DISPLAY`); janelas em outro display não são vistas.
- O provider `claude-cli` não faz tool-use nem visão — use chave/OAuth Anthropic ou OpenAI.
- `LinuxPlatform` (xdotool) foi mantida mas não foi testada nesta máquina.

## Módulos fora de escopo (intocados, não usados no fluxo macOS)
`core/agent/src/tools/playwright-browser.ts` (`applyStealth`, UA falso, `humanMoveTo`, `pressAndHold`),
`core/agent/src/tools/real-mouse.ts` (xdotool "humano"), ação `press_hold` em `browser/agent.ts`
e as instruções de anti-bot em `browser/prompt.ts`. O fluxo macOS usa `cdp-browser.ts` + `prompt-macos.ts`.
