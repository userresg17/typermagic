#!/usr/bin/env python3
"""Ouvido do Jarvis: microfone sempre ligado, 100% local, e só reage a "oi Jarvis".

Pipeline: microfone 16 kHz → Silero VAD (detecta início/fim de fala) → Whisper (sherpa-onnx)
nos primeiros segundos de cada fala → se começa com "oi Jarvis" (ou "Jarvis"), transcreve a fala
inteira e emite o comando. Nada sai da máquina; o áudio fica só em memória.

Por que não openWakeWord: o modelo pronto é o "hey Jarvis" em inglês e não dispara com "oi
Jarvis" falado em português (medido em 11/10/2026: 0,00–0,02 de score). Whisper small + regra
de prefixo acertou o "oi Jarvis" nas vozes pt-BR do macOS em ~0,2 s por trecho.

Protocolo (JSON por linha):
  stdout → {"event":"ready"} | {"event":"wake"} | {"event":"command","text":"..."}
           {"event":"interrupt"} | {"event":"heard","text":"..."} | {"event":"error","error":"..."}
  stdin  ← {"cmd":"speaking","on":true|false}   (enquanto fala, só "oi Jarvis" interrompe)
           {"cmd":"listen","seconds":8}          (janela de conversa: escuta sem precisar chamar)
"""

from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
import time
import unicodedata

VOICE_DIR = os.path.expanduser(os.environ.get("JARVIS_VOICE_DIR", "~/.typer/voice"))
MODEL = os.environ.get("JARVIS_ASR", "small")  # small (preciso) | base (rápido)
SR = 16000
WAKE_PROBE_S = 2.6  # segundos iniciais transcritos p/ checar a palavra de ativação
MAX_SPEECH_S = 25.0


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    sys.stderr.write(f"[ear] {msg}\n")
    sys.stderr.flush()


# ---------------------------------------------------------------- palavra de ativação

# comparadas na forma CRUA (minúscula, sem pontuação): "ô Jarvis" vale, "o Jarvis do filme" não.
GREETINGS = {"oi", "oii", "oie", "ói", "ôi", "ei", "hey", "hei", "ô", "olá", "ola", "alô", "alo", "e aí", "aí"}


def _plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", s)


def _lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _is_name(tok: str) -> bool:
    if not tok or tok[0] not in "jdgz":
        return False
    t = tok[1:] if tok.startswith("dj") else tok
    return _lev(t, "jarvis") <= 2 or t in {"jarvi", "jarviz", "jarves", "jervis", "jorvis", "jarbas"}


def split_wake(text: str) -> tuple[bool, str]:
    """("oi Jarvis, abre o navegador") → (True, "abre o navegador"). Exige o nome nas 3 primeiras
    palavras e, se o nome não for a 1ª palavra, uma saudação antes dele (evita disparar com
    "o Jarvis do filme…")."""
    words = text.strip().split()
    plain = [_plain(w).strip() for w in words]
    raw = [re.sub(r"[^\w]+", "", w.lower()) for w in words]
    for i, p in enumerate(plain[:3]):
        if _is_name(p.replace(" ", "")):
            before = [x for x in raw[:i] if x]
            if before and not all(b in GREETINGS for b in before):
                return False, ""
            rest = " ".join(words[i + 1 :]).lstrip(" ,.!?;:-–—").strip()
            return True, rest
    return False, ""


# ---------------------------------------------------------------- áudio + reconhecimento


class Ear:
    def __init__(self) -> None:
        import numpy as np  # noqa: F401
        import sherpa_onnx

        d = os.path.join(VOICE_DIR, f"sherpa-onnx-whisper-{MODEL}")
        enc = os.path.join(d, f"{MODEL}-encoder.int8.onnx")
        dec = os.path.join(d, f"{MODEL}-decoder.int8.onnx")
        if not os.path.exists(enc):  # modelo base vem sem int8
            enc, dec = os.path.join(d, f"{MODEL}-encoder.onnx"), os.path.join(d, f"{MODEL}-decoder.onnx")
        self.asr = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=enc, decoder=dec, tokens=os.path.join(d, f"{MODEL}-tokens.txt"),
            language="pt", task="transcribe", num_threads=4,
        )
        cfg = sherpa_onnx.VadModelConfig()
        cfg.silero_vad.model = os.path.join(VOICE_DIR, "silero_vad.onnx")
        cfg.silero_vad.threshold = float(os.environ.get("JARVIS_VAD_THRESHOLD", "0.5"))
        cfg.silero_vad.min_silence_duration = float(os.environ.get("JARVIS_SILENCE_S", "0.7"))
        cfg.silero_vad.min_speech_duration = 0.25
        cfg.silero_vad.max_speech_duration = MAX_SPEECH_S
        cfg.sample_rate = SR
        self.window = cfg.silero_vad.window_size
        self.vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)
        self.speaking = False
        self.listen_until = 0.0
        self.audio: "queue.Queue" = queue.Queue()

    def transcribe(self, samples) -> str:
        s = self.asr.create_stream()
        s.accept_waveform(SR, samples)
        self.asr.decode_stream(s)
        return s.result.text.strip()

    def on_segment(self, samples) -> None:
        dur = len(samples) / SR
        if dur < 0.35:
            return
        in_window = time.time() < self.listen_until and not self.speaking
        if in_window:
            text = self.transcribe(samples)
            if not text or re.fullmatch(r"[\W_]*", text):
                return
            woke, rest = split_wake(text)
            self.listen_until = 0.0
            emit({"event": "command", "text": rest if woke and rest else text, "followup": True})
            return
        probe = samples[: int(WAKE_PROBE_S * SR)]
        head = self.transcribe(probe)
        woke, _ = split_wake(head)
        if not woke:
            if os.environ.get("JARVIS_DEBUG"):
                emit({"event": "heard", "text": head})
            return
        if self.speaking:
            emit({"event": "interrupt"})
        full = head if dur <= WAKE_PROBE_S else self.transcribe(samples)
        _, rest = split_wake(full)
        if len(re.sub(r"\W+", "", rest)) >= 2:
            emit({"event": "command", "text": rest})
        else:
            emit({"event": "wake"})
            self.listen_until = time.time() + 8.0

    def stdin_loop(self) -> None:
        for line in sys.stdin:
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("cmd") == "speaking":
                self.speaking = bool(msg.get("on"))
            elif msg.get("cmd") == "listen":
                self.listen_until = time.time() + float(msg.get("seconds", 8))
        os._exit(0)  # pai fechou o stdin: encerra

    def run(self) -> None:
        import numpy as np
        import sounddevice as sd

        threading.Thread(target=self.stdin_loop, daemon=True).start()

        def cb(indata, _frames, _t, status):
            if status:
                log(str(status))
            self.audio.put(indata[:, 0].copy())

        dev = os.environ.get("JARVIS_MIC") or None
        with sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=self.window, device=dev, callback=cb):
            emit({"event": "ready", "model": MODEL, "device": str(sd.query_devices(dev, "input")["name"])})
            buf = np.zeros(0, dtype=np.float32)
            while True:
                buf = np.concatenate([buf, self.audio.get()])
                while len(buf) >= self.window:
                    self.vad.accept_waveform(buf[: self.window])
                    buf = buf[self.window :]
                while not self.vad.empty():
                    seg = np.array(self.vad.front.samples, dtype=np.float32)
                    self.vad.pop()
                    try:
                        self.on_segment(seg)
                    except Exception as e:  # um erro de reconhecimento nunca derruba o ouvido
                        emit({"event": "error", "error": f"{type(e).__name__}: {e}"[:300]})


def respawn_disclaimed() -> None:
    """Igual ao sidecar do desktop: faz este python responder por si mesmo perante o TCC do
    macOS (permissão de MICROFONE), em vez do launchd/bash/node que o lançaram."""
    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    attr = ctypes.c_void_p()
    if libc.posix_spawnattr_init(ctypes.byref(attr)) != 0:
        return
    try:
        libc.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr), 1)
    except AttributeError:
        return
    argv = [sys.executable, "-I", os.path.abspath(__file__)]
    env = dict(os.environ, JARVIS_DISCLAIMED="1")
    c_argv = (ctypes.c_char_p * (len(argv) + 1))(*[a.encode() for a in argv], None)
    c_env = (ctypes.c_char_p * (len(env) + 1))(*[f"{k}={v}".encode() for k, v in env.items()], None)
    pid = ctypes.c_int()
    rc = libc.posix_spawn(ctypes.byref(pid), argv[0].encode(), None, ctypes.byref(attr), c_argv, c_env)
    libc.posix_spawnattr_destroy(ctypes.byref(attr))
    if rc != 0:
        return
    import signal

    def fwd(signum, _frame):
        try:
            os.kill(pid.value, signum)
        except ProcessLookupError:
            pass

    for sg in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sg, fwd)
    _, status = os.waitpid(pid.value, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--test-wake":
        for t in sys.argv[2:]:
            print(json.dumps({"in": t, "out": split_wake(t)}, ensure_ascii=False))
        return
    if os.environ.get("JARVIS_DISCLAIMED") != "1" and os.environ.get("JARVIS_NO_DISCLAIM") != "1":
        respawn_disclaimed()
    try:
        Ear().run()
    except Exception as e:
        emit({"event": "error", "fatal": True, "error": f"{type(e).__name__}: {e}"[:500]})
        sys.exit(1)


if __name__ == "__main__":
    main()
