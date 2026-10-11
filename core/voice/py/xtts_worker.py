#!/usr/bin/env python3
# core/voice/py/xtts_worker.py
# Worker persistente do XTTS-v2 (Coqui, fork mantido `coqui-tts`). Carrega o modelo UMA vez e
# sintetiza sob demanda: lê JSON por linha no stdin, escreve JSON por linha no stdout.
#   entrada:  {"id": N, "text": "...", "out": "/tmp/x.wav", "language": "pt", "speaker": "...", "speaker_wav": "..."}
#   pronto:   {"ready": true, "speakers": [...]}
#   sucesso:  {"id": N, "ok": true}
#   erro:     {"id": N, "error": "..."}
# Tudo LOCAL. XTTS faz pt-BR de verdade e pronuncia inglês nativo. Roda em CPU (lento, ok).
import sys, os, json, traceback


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    # aceita a licença do modelo (CPML) sem prompt interativo — senão trava esperando "y".
    os.environ.setdefault("COQUI_TOS_AGREED", "1")
    try:
        import torch  # noqa: F401
        from TTS.api import TTS
    except Exception as e:  # dependência ausente
        emit({"fatal": f"import falhou: {e}"})
        return

    model_name = os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
    # Dispositivo: XTTS_DEVICE=mps|cuda|cpu|auto. "auto" usa a GPU do Mac (Metal/MPS) quando existe —
    # muito mais rápido que CPU no Apple Silicon. Ops sem kernel MPS caem p/ CPU (fallback do torch).
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    want = os.environ.get("XTTS_DEVICE", "auto")
    device = "cpu"
    try:
        if want in ("auto", "mps") and torch.backends.mps.is_available():
            device = "mps"
        elif want in ("auto", "cuda") and torch.cuda.is_available():
            device = "cuda"
    except Exception:
        device = "cpu"
    try:
        tts = TTS(model_name)  # baixa o modelo (~2GB) na 1ª vez
        try:
            tts.to(device)
        except Exception as e:
            sys.stderr.write(f"[xtts] {device} indisponível ({e}); usando cpu\n")
            device = "cpu"
            tts.to("cpu")
    except Exception as e:
        emit({"fatal": f"load falhou: {e}"})
        return
    sys.stderr.write(f"[xtts] modelo carregado em {device}\n")

    speakers = list(getattr(tts, "speakers", None) or [])
    default_speaker = speakers[0] if speakers else None
    emit({"ready": True, "speakers": speakers[:80], "device": device})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        rid = req.get("id")
        try:
            kwargs = {
                "text": req["text"],
                "language": req.get("language", "pt"),
                "file_path": req["out"],
            }
            if req.get("speed"):
                kwargs["speed"] = float(req["speed"])  # 1.1 = 10% mais rápido
            if req.get("speaker_wav"):
                kwargs["speaker_wav"] = req["speaker_wav"]
            elif req.get("speaker") or default_speaker:
                kwargs["speaker"] = req.get("speaker") or default_speaker
            tts.tts_to_file(**kwargs)
            emit({"id": rid, "ok": True})
        except Exception as e:
            emit({"id": rid, "error": str(e), "trace": traceback.format_exc()[-400:]})


if __name__ == "__main__":
    main()
