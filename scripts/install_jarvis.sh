#!/bin/bash
# Instala e liga o JARVIS: conversa por voz no Mac, sem apertar nada ("oi Jarvis, ...").
# Ouvido 100% local: Silero VAD + Whisper small (sherpa-onnx) num venv próprio. Mesmo agente,
# mesmas ferramentas e mesmas confirmações do gateway do Telegram, em outro serviço (isolado).
#   scripts/install_jarvis.sh            instala modelos/venv e sobe o serviço
#   scripts/install_jarvis.sh --restart  só reinicia
#   scripts/install_jarvis.sh --stop     desliga o serviço (o microfone fecha)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.typermagic.jarvis"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
V="$HOME/.typer/voice"
case "${1:-}" in
  --stop) launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; echo "Jarvis desligado."; exit 0 ;;
  --restart) launchctl kickstart -k "gui/$(id -u)/$LABEL"; echo "Jarvis reiniciado."; exit 0 ;;
esac
mkdir -p "$V" "$HOME/Library/Logs/typermagic"
if [ ! -x "$V/jarvis-venv/bin/python" ]; then
  uv venv --python 3.12 "$V/jarvis-venv" -q
  VIRTUAL_ENV="$V/jarvis-venv" uv pip install -q sherpa-onnx sounddevice numpy
fi
[ -f "$V/silero_vad.onnx" ] || curl -sL -o "$V/silero_vad.onnx" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
if [ ! -f "$V/sherpa-onnx-whisper-small/small-encoder.int8.onnx" ]; then
  curl -sL -o "$V/ws.tar.bz2" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2
  tar xjf "$V/ws.tar.bz2" -C "$V" && rm "$V/ws.tar.bz2"
fi
(cd "$ROOT" && pnpm -r build >/dev/null)
sed -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" "$ROOT/deploy/macos/$LABEL.plist.template" > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for _ in $(seq 1 20); do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
sleep 2
launchctl print "gui/$(id -u)/$LABEL" | grep -q "state = running" && echo "✓ Jarvis no ar. Diga: oi Jarvis" || { echo "✗ não subiu — veja ~/Library/Logs/typermagic/jarvis.err.log"; exit 1; }
echo "Na 1ª vez o macOS pede acesso ao MICROFONE para o python3.12: clique Permitir."
