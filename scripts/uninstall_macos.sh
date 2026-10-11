#!/usr/bin/env bash
# scripts/uninstall_macos.sh — remove o LaunchAgent e (opcional) dados locais.
#   padrão: para e remove o serviço; mantém .env, .typer/, ~/.typer (cofre, perfil do navegador)
#   --purge: apaga também .venv, node_modules/dist do repo, ~/.typer/browser/cdp-profile e logs.
#            NUNCA apaga ~/.typer/vault.enc nem o .env sem --purge-secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.typermagic.gateway"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "✓ serviço parado" || echo "· serviço não estava carregado"
[[ -f "$PLIST" ]] && rm -f "$PLIST" && echo "✓ $PLIST removido"
pkill -f "user-data-dir=$HOME/.typer/browser/cdp-profile" 2>/dev/null && echo "✓ navegador dedicado fechado" || true
for a in "$@"; do
  case "$a" in
    --purge)
      rm -rf "$ROOT/.venv" "$HOME/.typer/browser/cdp-profile" "$HOME/Library/Logs/typermagic"
      (cd "$ROOT" && rm -rf node_modules core/*/dist app/*/dist)
      echo "✓ purge: venv, perfil do navegador, logs, node_modules/dist"
      ;;
    --purge-secrets)
      rm -f "$ROOT/.env" "$HOME/.typer/vault.enc" "$HOME/.typer/vault.key" "$HOME/.typer/auth.json" "$HOME/.typer/spend.json"
      echo "✓ purge-secrets: .env, cofre, auth.json"
      ;;
  esac
done
echo "pronto."
