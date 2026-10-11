# platform/macos/scripting.py — wrapper SEGURO de osascript/JXA e `open -a`.
# Nome de app validado por regex e passado como ARGUMENTO (nunca interpolado no script):
# o script é fixo, o dado vai em argv — anti-injeção. Scripts livres (JXA) só com aprovação
# humana (gate fica no TS: ferramenta requiresApproval).
from __future__ import annotations

import re
import subprocess

APP_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._'\-]{0,63}$")


def _check_app(name: str) -> str:
    if not APP_NAME.match(name):
        raise ValueError(f"nome de app inválido: {name!r}")
    return name


def _osascript(lang: str, source: str, args: list[str], timeout: float = 30) -> str:
    cmd = ["/usr/bin/osascript", "-l", lang, "-", *args]
    r = subprocess.run(cmd, input=source, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:400] or f"osascript saiu com {r.returncode}")
    return r.stdout.strip()


def open_app(name: str) -> str:
    _check_app(name)
    r = subprocess.run(["/usr/bin/open", "-a", name], capture_output=True, text=True, timeout=20)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:300] or f"open -a {name} falhou")
    return f"{name} aberto"


def focus_app(name: str) -> str:
    _check_app(name)
    return _osascript("AppleScript", 'on run argv\ntell application (item 1 of argv) to activate\nend run', [name])


def quit_app(name: str) -> str:
    _check_app(name)
    return _osascript("AppleScript", 'on run argv\ntell application (item 1 of argv) to quit\nend run', [name])


def is_running(name: str) -> bool:
    _check_app(name)
    out = _osascript("AppleScript", 'on run argv\ntell application "System Events" to return (name of processes) contains (item 1 of argv)\nend run', [name])
    return out.lower() == "true"


def run_jxa(source: str, args: list[str] | None = None) -> str:
    """JXA livre (JavaScript for Automation). Chamado só depois do gate de aprovação no TS."""
    return _osascript("JavaScript", source, args or [])


def run_applescript(source: str, args: list[str] | None = None) -> str:
    return _osascript("AppleScript", source, args or [])
