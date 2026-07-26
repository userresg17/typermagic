#!/usr/bin/env bash
# Deploy do site no Fly.io — rode na SUA máquina, dentro da pasta site-otc/.
#
#   1) instale o flyctl (uma vez):  curl -L https://fly.io/install.sh | sh
#   2) exporte seu token:           export FLY_API_TOKEN='FlyV1 fm2_...'
#   3) rode:                        ./deploy.sh
#
# O build acontece no builder remoto da Fly (não precisa de Docker nem Node local).
set -euo pipefail

if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl não encontrado. Instale com: curl -L https://fly.io/install.sh | sh"
  exit 1
fi

if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "Defina o token antes: export FLY_API_TOKEN='FlyV1 fm2_...'"
  exit 1
fi

APP="$(grep -E '^app *= *' fly.toml | sed -E 's/app *= *"(.*)"/\1/')"

echo "→ garantindo que o app '$APP' existe..."
flyctl apps create "$APP" 2>/dev/null || true

echo "→ deploy..."
flyctl deploy --remote-only --ha=false

echo ""
echo "✅ no ar: https://$APP.fly.dev"
