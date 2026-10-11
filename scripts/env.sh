#!/usr/bin/env bash
# scripts/env.sh — carrega o .env do repo (se existir) no ambiente e executa o comando dado.
# Por quê: o TYPER lê só process.env; o LaunchAgent não tem EnvironmentFile (systemd tinha).
# Uso: scripts/env.sh node app/agent-cli/dist/main.js gateway telegram
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
# expande ~ nas variáveis de caminho (o .env não expande sozinho)
for v in TYPER_BROWSER_PROFILE TYPER_STOP_FILE TYPER_STEP_LOG TYPER_LOG_DIR; do
  val="${!v:-}"
  [[ "$val" == "~"* ]] && export "$v=${HOME}${val:1}"
done
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export TYPER_PY="${TYPER_PY:-$ROOT/.venv/bin/python}"
cd "$ROOT"
exec "$@"
