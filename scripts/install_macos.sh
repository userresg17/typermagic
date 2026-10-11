#!/usr/bin/env bash
# scripts/install_macos.sh — instala/atualiza o TYPER Magic no macOS, idempotente:
#   1) Homebrew deps (node, pnpm, uv, ripgrep)   2) pnpm install + build   3) venv Python + pyobjc
#   4) .env (cria do exemplo se faltar)          5) .typer/gateway.json    6) LaunchAgent (KeepAlive)
#   7) doctor
# NÃO usa sudo. NÃO mexe em pmset/caffeinate/login automático (ver README_MACOS.md → 24/7).
# Flags: --no-service (não instala o LaunchAgent) · --restart (só reinicia o serviço)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LABEL="com.typermagic.gateway"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/typermagic"
NO_SERVICE=0; RESTART_ONLY=0
for a in "$@"; do
  case "$a" in
    --no-service) NO_SERVICE=1 ;;
    --restart) RESTART_ONLY=1 ;;
  esac
done
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

install_service() {
  mkdir -p "$HOME/Library/LaunchAgents" "$LOGS"
  sed -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" deploy/macos/$LABEL.plist.template > "$PLIST"
  # recarrega de forma idempotente (bootout ignora se não estava carregado)
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  # espera o job sumir de verdade (bootout é assíncrono; bootstrap em cima dele dá "Input/output error")
  for _ in $(seq 1 20); do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  sleep 2
  if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q "state = running"; then
    echo "✓ serviço $LABEL rodando (logs: $LOGS/gateway.err.log)"
  else
    echo "✗ serviço não está rodando — veja: tail -50 $LOGS/gateway.err.log"; exit 1
  fi
}

if [[ $RESTART_ONLY -eq 1 ]]; then install_service; exit 0; fi

say "1/7 Homebrew e dependências"
command -v brew >/dev/null || { echo "✗ Homebrew não encontrado: https://brew.sh"; exit 1; }
for pkg in node pnpm uv ripgrep; do
  if ! brew list --versions "$pkg" >/dev/null 2>&1; then brew install "$pkg"; else echo "✓ $pkg"; fi
done

say "2/7 Dependências Node e build"
pnpm install --frozen-lockfile
pnpm -r build

say "3/7 Python (venv + pyobjc) p/ a camada macOS"
[[ -x .venv/bin/python ]] || uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -q pyobjc-core pyobjc-framework-Cocoa pyobjc-framework-Quartz \
  pyobjc-framework-ApplicationServices pyobjc-framework-ScreenCaptureKit pytest
echo "✓ venv: $(.venv/bin/python --version)"

say "4/7 .env"
if [[ ! -f .env ]]; then
  cp .env.example .env; chmod 600 .env
  echo "⚠ criei .env a partir do .env.example — preencha TYPER_TELEGRAM_TOKEN, TYPER_TELEGRAM_ALLOW e TYPER_ANTHROPIC_KEY e rode de novo."
  exit 2
fi
chmod 600 .env
echo "✓ .env presente (600)"

say "5/7 .typer/gateway.json"
scripts/env.sh node scripts/gen_gateway_json.mjs

say "6/7 Serviço (LaunchAgent)"
if [[ $NO_SERVICE -eq 1 ]]; then echo "(pulado: --no-service)"; else install_service; fi

say "7/7 Doctor"
.venv/bin/python scripts/doctor.py || { echo; echo "⚠ doctor apontou pendências (acima). Permissões TCC só você concede — ver README_MACOS.md."; exit 3; }
echo; echo "✅ Instalado. Fale com o bot no Telegram: /status"
