#!/usr/bin/env python3
# scripts/test_macos_platform.py — verificação da Fase 2 (ponta a ponta, sem LLM):
# abre o TextEdit, cria documento, digita uma frase, tira screenshot, lê a árvore AX, confere o
# texto na árvore, mede a conversão Retina (mouse) e fecha o app. Exige Accessibility + Screen
# Recording concedidos ao python do venv. Rode: .venv/bin/python scripts/test_macos_platform.py
from __future__ import annotations

import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "platform"))
from macos import ax, input as inp, screen, scripting, tcc  # noqa: E402

APP = "TextEdit"


def need_front() -> None:
    """só manda tecla se o TextEdit estiver em foco — senão a tecla iria pro app do usuário."""
    cur = ax.frontmost_app()["name"]
    if cur != APP:
        raise RuntimeError(f"app em foco é {cur!r}, não {APP} — tecla NÃO enviada")


def key(combo: str) -> None:
    need_front()
    inp.key(combo)


def type_text(t: str) -> None:
    need_front()
    inp.type_text(t)

PHRASE = "Olá do TYPER Magic no macOS"
fails: list[str] = []


def step(name: str, fn):
    try:
        r = fn()
        print(f"  ✓ {name}" + (f" — {r}" if r else ""))
        return r
    except Exception as e:
        print(f"  ✗ {name} — {type(e).__name__}: {e}")
        fails.append(name)
        return None


def main() -> int:
    print("Fase 2 — teste da camada macOS")
    st = tcc.status()
    print(f"  TCC: screen_recording={st['screen_recording']} accessibility={st['accessibility']}")
    for line in st["instructions"]:
        print("    ! " + line)

    g = screen.geometry("main", 1440)
    step("geometria", lambda: f"{g.width_pt:.0f}x{g.height_pt:.0f} pt, escala {g.scale:.0f}x, lógico {g.logical_width}x{g.logical_height}")

    step("abrir TextEdit", lambda: scripting.open_app("TextEdit"))
    time.sleep(1.5)
    step("focar TextEdit", lambda: scripting.focus_app("TextEdit"))
    time.sleep(0.8)
    front = step("app em foco", lambda: ax.frontmost_app()["name"])
    if front != "TextEdit":
        fails.append("foco")

    def novo_doc():
        # TextEdit pode abrir com o painel "Abrir" (sem documento): fecha com Escape antes do cmd+n
        key("escape")
        time.sleep(0.4)
        key("cmd+n")
        time.sleep(1.0)
        return "cmd+n"

    step("novo documento", novo_doc)

    def digitar():
        type_text(PHRASE)
        time.sleep(0.5)
        return f"{len(PHRASE)} chars"

    step("digitar frase", digitar)

    def arvore():
        t = ax.tree()
        texts = " | ".join(n["value"] or n["label"] for n in t["nodes"] if n["role"] in ("TextArea", "StaticText", "Window"))
        if PHRASE not in texts:
            raise AssertionError(f"frase não apareceu na árvore AX ({len(t['nodes'])} nós): {texts[:120]!r}")
        return f"{len(t['nodes'])} nós, frase encontrada"

    step("árvore AX contém a frase", arvore)

    def shot():
        r = screen.screenshot("main", 1440)
        if r["width"] != g.logical_width or r["height"] != g.logical_height:
            raise AssertionError(f"dimensões {r['width']}x{r['height']} != lógico")
        return f"{r['width']}x{r['height']} via {r['backend']}, {len(r['png_base64'])//1024} KB b64"

    step("screenshot na resolução lógica", shot)

    def retina():
        # move p/ pontos conhecidos (lógico) e confere a posição real (pontos → lógico)
        for lx, ly in ((100, 100), (g.logical_width - 50, g.logical_height - 50), (720, 400)):
            px, py = g.logical_to_points(lx, ly)
            inp.mouse_move(px, py)
            time.sleep(0.08)
            rx, ry = g.points_to_logical(*inp.mouse_location())
            if abs(rx - lx) > 2 or abs(ry - ly) > 2:
                raise AssertionError(f"pedi ({lx},{ly}) e o cursor está em ({rx:.0f},{ry:.0f})")
        return "3 pontos conferidos (±2 px lógicos)"

    step("conversão Retina (mouse em pontos conhecidos)", retina)

    def fechar():
        # fecha SEM atalho cego: quit via AppleScript; o diálogo "salvar?" é tratado por AX só se
        # o TextEdit estiver em foco; nunca cmd+w/cmd+delete (iam p/ o app do usuário).
        scripting.quit_app(APP)
        time.sleep(0.8)
        if ax.frontmost_app()["name"] == APP:
            t = ax.tree()
            for n in t["nodes"]:
                if n["role"] == "Button" and n["label"].lower() in ("delete", "apagar", "don't save", "não salvar"):
                    ax.act(n["id"], "Press")
                    break
            time.sleep(0.5)
            scripting.quit_app(APP)
        return "fechado sem salvar"

    step("fechar TextEdit", fechar)

    print()
    if fails:
        print(f"✗ {len(fails)} passo(s) falharam: {', '.join(fails)}")
        return 1
    print("✓ Fase 2 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
