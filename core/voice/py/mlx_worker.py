#!/usr/bin/env python3
"""Worker de voz na GPU do Mac (Apple Silicon) via mlx-audio. Mesmo protocolo do xtts_worker:
  pronto:   {"ready": true, "model": "...", "device": "gpu"}
  pedido:   {"id": 1, "text": "...", "out": "/tmp/x.wav", "voice": "pf_dora", "lang": "p", "speed": 1.1}
  resposta: {"id": 1, "ok": true} | {"id": 1, "ok": false, "error": "..."}
Modelo em MLX_TTS_MODEL (default Kokoro-82M, que no teste de 11/10/2026 pronunciou pt-BR sem
erro e gerou 7 s de fala em 0,3 s). Carrega UMA vez e fica quente."""

import json
import os
import sys
import traceback


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    try:
        import mlx.core as mx
        import numpy as np
        import soundfile as sf
        from mlx_audio.tts.utils import load_model

        repo = os.environ.get("MLX_TTS_MODEL", "mlx-community/Kokoro-82M-bf16")
        model = load_model(repo)
        dv = os.environ.get("MLX_TTS_VOICE", "pf_dora")
        dl = os.environ.get("MLX_TTS_LANG", "p")
        # voz de referência fixa (clonagem): mantém o MESMO timbre em toda frase (Qwen3-TTS Base)
        ref_audio = os.environ.get("MLX_TTS_REF_AUDIO") or None
        ref_text = os.environ.get("MLX_TTS_REF_TEXT") or None

        import re

        # pausas de respiração (s) depois de cada pontuação — fala de gente, não de robô
        PAUSA = {",": 0.16, ";": 0.24, ":": 0.24, ".": 0.34, "!": 0.34, "?": 0.38, "…": 0.42}
        mult = float(os.environ.get("MLX_TTS_PAUSE", "1.0"))

        def gen_raw(text, voice, lang, speed):
            parts, sr = [], 24000
            kw = {"ref_audio": ref_audio, "ref_text": ref_text} if ref_audio else {"voice": voice}
            for r in model.generate(text=text, lang_code=lang, speed=speed, **kw):
                parts.append(np.array(r.audio))
                sr = r.sample_rate
            return (np.concatenate(parts) if parts else np.zeros(1, dtype="float32")), sr

        def gen(text, voice, lang, speed):
            pedacos = [p for p in re.split(r"(?<=[,;:.!?…])\s+", text.strip()) if p.strip()]
            out, sr = [], 24000
            for p in pedacos:
                a, sr = gen_raw(p, voice, lang, speed)
                out.append(a.astype("float32"))
                pausa = PAUSA.get(p.rstrip()[-1:], 0.0) * mult
                if pausa:
                    out.append(np.zeros(int(sr * pausa), dtype="float32"))
            return (np.concatenate(out) if out else np.zeros(1, dtype="float32")), sr

        gen("Pronto.", dv, dl, 1.0)  # aquece (compila os kernels)
    except Exception as e:
        emit({"fatal": f"{type(e).__name__}: {e}"})
        return
    emit({"ready": True, "model": repo, "device": str(mx.default_device())})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        rid = req.get("id")
        try:
            audio, sr = gen(req["text"], req.get("voice") or dv, req.get("lang") or dl, float(req.get("speed") or 1.0))
            sf.write(req["out"], audio, sr)
            emit({"id": rid, "ok": True})
        except Exception as e:
            emit({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"[:400]})
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
