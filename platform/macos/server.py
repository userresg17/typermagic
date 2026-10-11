#!/usr/bin/env python3
# platform/macos/server.py — sidecar JSON-lines. Lê {"id","op",...} no stdin, responde
# {"id","ok":true,"result"} ou {"id","ok":false,"error"} no stdout (uma linha por mensagem).
# Logs vão p/ stderr. Nunca imprime segredo (não há segredo aqui — só eventos de UI).
# Uso direto p/ depurar:  echo '{"id":1,"op":"screen_size"}' | .venv/bin/python platform/macos/server.py
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from macos import ax, geometry as geo, input as inp, screen, scripting, tcc  # noqa: E402

DISPLAY = os.environ.get("TYPER_DISPLAY", "main")
LOGICAL = int(os.environ.get("TYPER_SCREEN_LOGICAL_WIDTH", "1440"))
PREFER = os.environ.get("TYPER_SCREENSHOT_BACKEND", "sck")


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def g() -> geo.DisplayGeometry:
    return screen.geometry(DISPLAY, LOGICAL)


def to_pt(x: float, y: float) -> tuple[float, float]:
    gg = g()
    return gg.logical_to_points(*gg.clamp_logical(float(x), float(y)))


INPUT_OPS = {"mouse_move", "click", "double_click", "drag", "scroll", "type", "key"}


def guard_app(a: dict) -> None:
    """Se o chamador disse QUAL app deve estar em foco (expect_app), recheca AGORA — logo antes de
    postar o evento. Sem isso, se o usuário troca de janela entre a decisão e a execução, um
    cmd+w vai pro app errado (aconteceu: fechou a aba do dono, 11/10)."""
    exp = a.get("expect_app")
    if not exp:
        return
    cur = ax.frontmost_app()
    if cur["name"].lower() != str(exp).lower() and cur["localized"].lower() != str(exp).lower():
        raise RuntimeError(f"app em foco é '{cur['name']}', esperado '{exp}' — evento NÃO enviado")


def handle(op: str, a: dict) -> object:
    if op in INPUT_OPS:
        guard_app(a)
    if op == "ping":
        return {"pong": True, "pid": os.getpid()}
    if op == "screen_size":
        gg = g()
        return {"width": gg.logical_width, "height": gg.logical_height, "scale": gg.scale,
                "display_pt": [gg.width_pt, gg.height_pt], "origin_pt": [gg.origin_x, gg.origin_y]}
    if op == "screenshot":
        return screen.screenshot(DISPLAY, LOGICAL, PREFER)
    if op == "tcc":
        return tcc.status()
    if op == "tcc_request":
        tcc.request_prompts()
        return tcc.status()
    if op == "mouse_move":
        inp.mouse_move(*to_pt(a["x"], a["y"]))
        return {"ok": True}
    if op == "mouse_location":
        gg = g()
        px, py = inp.mouse_location()
        lx, ly = gg.points_to_logical(px, py)
        return {"x": lx, "y": ly, "points": [px, py]}
    if op == "click":
        inp.click(*to_pt(a["x"], a["y"]), button=a.get("button", "left"), clicks=int(a.get("clicks", 1)))
        return {"ok": True}
    if op == "double_click":
        inp.click(*to_pt(a["x"], a["y"]), clicks=2)
        return {"ok": True}
    if op == "drag":
        x1, y1 = to_pt(a["x1"], a["y1"])
        x2, y2 = to_pt(a["x2"], a["y2"])
        inp.drag(x1, y1, x2, y2)
        return {"ok": True}
    if op == "scroll":
        gg = g()
        x, y = to_pt(a.get("x", gg.logical_width / 2), a.get("y", gg.logical_height / 2))
        inp.scroll(x, y, int(a.get("dy", -300)), int(a.get("dx", 0)))
        return {"ok": True}
    if op == "type":
        inp.type_text(str(a["text"]))
        return {"ok": True, "chars": len(str(a["text"]))}
    if op == "key":
        inp.key(str(a["combo"]))
        return {"ok": True}
    if op == "frontmost":
        return ax.frontmost_app()
    if op == "ax_tree":
        return ax.tree(int(a.get("max_nodes", 400)), int(a.get("max_depth", 10)))
    if op == "ax_find":
        return {"ids": ax.find(str(a["label"]), a.get("role"))}
    if op == "ax_act":
        return ax.act(int(a["id"]), str(a.get("action", "Press")), a.get("value"))
    if op == "ax_center":
        c = ax.center(int(a["id"]))
        if c is None:
            return None
        gg = g()
        lx, ly = gg.points_to_logical(*c)
        return {"x": lx, "y": ly}
    if op == "open_app":
        return {"message": scripting.open_app(str(a["name"]))}
    if op == "focus_app":
        scripting.focus_app(str(a["name"]))
        return {"ok": True}
    if op == "quit_app":
        scripting.quit_app(str(a["name"]))
        return {"ok": True}
    if op == "is_running":
        return {"running": scripting.is_running(str(a["name"]))}
    if op == "run_jxa":
        return {"output": scripting.run_jxa(str(a["source"]), list(a.get("args", [])))}
    if op == "run_applescript":
        return {"output": scripting.run_applescript(str(a["source"]), list(a.get("args", [])))}
    if op == "sleep":
        time.sleep(min(float(a.get("seconds", 1)), 10))
        return {"ok": True}
    raise ValueError(f"op desconhecida: {op}")


def main() -> None:
    emit({"ready": True, "pid": os.getpid(), "display": DISPLAY, "logical_width": LOGICAL})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            emit({"id": None, "ok": False, "error": "JSON inválido"})
            continue
        mid = msg.get("id")
        try:
            emit({"id": mid, "ok": True, "result": handle(str(msg.get("op", "")), msg)})
        except Exception as e:  # erro vira resposta, nunca derruba o sidecar
            emit({"id": mid, "ok": False, "error": f"{type(e).__name__}: {e}"[:500]})


if __name__ == "__main__":
    main()
