# platform/macos/input.py — entrada por eventos Quartz (CGEvent). Coordenadas em PONTOS globais;
# quem chama converte da resolução lógica (geometry.py). Sem jitter, sem curva "humana".
from __future__ import annotations

import time

import Quartz  # type: ignore

# teclado US (virtual keycodes). Letras/números/pontuação + teclas especiais.
KEYCODES: dict[str, int] = {
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
    "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
    "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
    "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
    ".": 47, "`": 50,
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "left": 123, "right": 124, "down": 125, "up": 126,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101,
    "f10": 109, "f11": 103, "f12": 111,
}
MODIFIERS: dict[str, int] = {
    "cmd": Quartz.kCGEventFlagMaskCommand, "command": Quartz.kCGEventFlagMaskCommand, "meta": Quartz.kCGEventFlagMaskCommand,
    "shift": Quartz.kCGEventFlagMaskShift,
    "alt": Quartz.kCGEventFlagMaskAlternate, "option": Quartz.kCGEventFlagMaskAlternate,
    "ctrl": Quartz.kCGEventFlagMaskControl, "control": Quartz.kCGEventFlagMaskControl,
}
BUTTONS = {
    "left": (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp, Quartz.kCGEventLeftMouseDragged, Quartz.kCGMouseButtonLeft),
    "right": (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp, Quartz.kCGEventRightMouseDragged, Quartz.kCGMouseButtonRight),
}


def _post(ev) -> None:
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def mouse_location() -> tuple[float, float]:
    p = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    return (p.x, p.y)


def mouse_move(x: float, y: float) -> None:
    _post(Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (x, y), Quartz.kCGMouseButtonLeft))


def click(x: float, y: float, button: str = "left", clicks: int = 1) -> None:
    down, up, _drag, btn = BUTTONS[button]
    mouse_move(x, y)
    time.sleep(0.03)
    for n in range(1, clicks + 1):
        d = Quartz.CGEventCreateMouseEvent(None, down, (x, y), btn)
        u = Quartz.CGEventCreateMouseEvent(None, up, (x, y), btn)
        Quartz.CGEventSetIntegerValueField(d, Quartz.kCGMouseEventClickState, n)
        Quartz.CGEventSetIntegerValueField(u, Quartz.kCGMouseEventClickState, n)
        _post(d)
        _post(u)
        if n < clicks:
            time.sleep(0.08)


def drag(x1: float, y1: float, x2: float, y2: float, steps: int = 12) -> None:
    down, up, dragged, btn = BUTTONS["left"]
    mouse_move(x1, y1)
    time.sleep(0.03)
    _post(Quartz.CGEventCreateMouseEvent(None, down, (x1, y1), btn))
    for i in range(1, steps + 1):
        t = i / steps
        _post(Quartz.CGEventCreateMouseEvent(None, dragged, (x1 + (x2 - x1) * t, y1 + (y2 - y1) * t), btn))
        time.sleep(0.015)
    _post(Quartz.CGEventCreateMouseEvent(None, up, (x2, y2), btn))


def scroll(x: float, y: float, dy: int, dx: int = 0) -> None:
    """dy>0 rola p/ cima (convenção do macOS); em pixels."""
    mouse_move(x, y)
    _post(Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitPixel, 2, int(dy), int(dx)))


MOD_KEYCODES = {"cmd": 55, "command": 55, "meta": 55, "shift": 56, "alt": 58, "option": 58, "ctrl": 59, "control": 59}


def type_text(text: str) -> None:
    """digita Unicode direto (independe de layout). Em blocos de 20 chars, SEM modificadores."""
    for i in range(0, len(text), 20):
        chunk = text[i : i + 20]
        d = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
        u = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
        Quartz.CGEventKeyboardSetUnicodeString(d, len(chunk), chunk)
        Quartz.CGEventKeyboardSetUnicodeString(u, len(chunk), chunk)
        # flags=0 explícito: sem isso o evento herda o estado atual do teclado (um Cmd "preso"
        # de um atalho anterior transformava "abc" em cmd+a, cmd+b, cmd+c — bug real, 11/10).
        Quartz.CGEventSetFlags(d, 0)
        Quartz.CGEventSetFlags(u, 0)
        _post(d)
        _post(u)
        time.sleep(0.01)


def key(combo: str) -> None:
    """combo tipo "cmd+s", "enter", "shift+tab", "cmd+shift+n". Modificadores são pressionados e
    SOLTOS como teclas reais (keycode 55/56/58/59), para o estado do teclado não ficar "preso"."""
    parts = [p.strip().lower() for p in combo.replace("-", "+").split("+") if p.strip()]
    mods: list[str] = []
    main: str | None = None
    for p in parts:
        if p in MOD_KEYCODES:
            mods.append(p)
        else:
            main = p
    if main is None or main not in KEYCODES:
        raise ValueError(f"tecla desconhecida em '{combo}'")
    flags = 0
    for m in mods:
        flags |= MODIFIERS[m]
        md = Quartz.CGEventCreateKeyboardEvent(None, MOD_KEYCODES[m], True)
        Quartz.CGEventSetFlags(md, flags)
        _post(md)
        time.sleep(0.01)
    code = KEYCODES[main]
    d = Quartz.CGEventCreateKeyboardEvent(None, code, True)
    u = Quartz.CGEventCreateKeyboardEvent(None, code, False)
    Quartz.CGEventSetFlags(d, flags)
    Quartz.CGEventSetFlags(u, flags)
    _post(d)
    time.sleep(0.02)
    _post(u)
    for m in reversed(mods):
        flags &= ~MODIFIERS[m]
        mu = Quartz.CGEventCreateKeyboardEvent(None, MOD_KEYCODES[m], False)
        Quartz.CGEventSetFlags(mu, flags)
        _post(mu)
        time.sleep(0.01)
