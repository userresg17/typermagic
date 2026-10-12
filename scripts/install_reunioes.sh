#!/usr/bin/env bash
# scripts/install_reunioes.sh — instala/reinicia a Central de Reuniões como LaunchAgent
# (com.typermagic.reunioes = `typermagic reunioes watch`: vigia Discord + Google Drive).
#   scripts/install_reunioes.sh            build + (re)instala e sobe o serviço
#   scripts/install_reunioes.sh --restart  só reinicia
#   scripts/install_reunioes.sh --stop     desliga
#   scripts/install_reunioes.sh --status   estado + últimas linhas do log
# A ingestão pelo Telegram (resumos do WhatsApp) e as perguntas ao agente ficam no gateway
# (com.typermagic.gateway) — depois de mudar o código, reinicie-o também: scripts/install_macos.sh --restart
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.typermagic.reunioes"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/typermagic"
uid="$(id -u)"
case "${1:-}" in
  --stop) launchctl bootout "gui/$uid/$LABEL" 2>/dev/null || true; echo "Central de Reuniões desligada."; exit 0 ;;
  --restart) launchctl kickstart -k "gui/$uid/$LABEL"; echo "Central de Reuniões reiniciada."; exit 0 ;;
  --status)
    launchctl print "gui/$uid/$LABEL" 2>/dev/null | grep -E "state =|pid =" || echo "não carregado"
    tail -n 15 "$LOGS/reunioes.err.log" 2>/dev/null || true
    exit 0 ;;
esac
mkdir -p "$HOME/Library/LaunchAgents" "$LOGS"
[[ -f "$ROOT/.env" ]] || { echo "✗ falta $ROOT/.env (rode scripts/install_macos.sh primeiro)"; exit 2; }
(cd "$ROOT" && pnpm -r build >/dev/null)
sed -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" "$ROOT/deploy/macos/$LABEL.plist.template" > "$PLIST"
launchctl bootout "gui/$uid/$LABEL" 2>/dev/null || true
for _ in $(seq 1 20); do launchctl print "gui/$uid/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "gui/$uid" "$PLIST"
launchctl kickstart -k "gui/$uid/$LABEL"
sleep 3
if launchctl print "gui/$uid/$LABEL" 2>/dev/null | grep -q "state = running"; then
  echo "✓ $LABEL rodando (log: $LOGS/reunioes.err.log)"
  tail -n 5 "$LOGS/reunioes.err.log" 2>/dev/null || true
else
  echo "✗ não subiu — veja: tail -50 $LOGS/reunioes.err.log"; exit 1
fi
