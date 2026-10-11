# platform/macos/tcc.py — detecta as permissões de privacidade (TCC) que o controle do Mac exige
# e produz a instrução EXATA quando faltam. O TCC atribui a permissão ao processo responsável:
# no LaunchAgent é o binário do python do venv; num terminal é o app do terminal.
from __future__ import annotations

import sys
from pathlib import Path


def real_python() -> str:
    return str(Path(sys.executable).resolve())


def status() -> dict:
    import Quartz  # type: ignore
    from ApplicationServices import AXIsProcessTrusted  # type: ignore

    screen = bool(Quartz.CGPreflightScreenCaptureAccess())
    ax = bool(AXIsProcessTrusted())
    return {
        "screen_recording": screen,
        "accessibility": ax,
        "binary": real_python(),
        "instructions": instructions(screen, ax),
    }


def instructions(screen: bool, ax: bool) -> list[str]:
    out: list[str] = []
    b = real_python()
    if not screen:
        out.append(
            "Screen Recording: Ajustes do Sistema › Privacidade e Segurança › Gravação de Tela e "
            f"Áudio do Sistema › (+) › adicionar o binário: {b}  (Cmd+Shift+G no diálogo e cole o caminho)."
        )
    if not ax:
        out.append(
            "Accessibility: Ajustes do Sistema › Privacidade e Segurança › Acessibilidade › (+) › "
            f"adicionar o binário: {b} e deixar a chave ligada."
        )
    if out:
        out.append("Depois de conceder, reinicie o serviço (ou o terminal) — a permissão só vale para processos novos.")
    return out


def request_prompts() -> None:
    """Dispara os diálogos do sistema (uma vez) p/ aparecerem na lista de Privacidade."""
    import Quartz  # type: ignore
    from ApplicationServices import AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt  # type: ignore

    Quartz.CGRequestScreenCaptureAccess()
    AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: True})
