# platform/macos — camada de controle do macOS (sidecar Python/pyobjc).
# Falada pelo TS (core/agent/src/platform/macos.ts) por JSON-lines em stdin/stdout, no mesmo
# padrão do core/voice/py/xtts_worker.py. Nada aqui tenta esconder automação: cliques são
# eventos Quartz normais, sem jitter nem "humanização" (fora de escopo por decisão do dono).
