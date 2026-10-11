# platform/macos/ax.py — árvore de acessibilidade (AXUIElement) do app em foco e ações por rótulo.
# O agente tenta AX PRIMEIRO (preciso, sem visão) e cai p/ screenshot+clique quando não há AX.
from __future__ import annotations

import re
from typing import Any

import ApplicationServices as AS  # type: ignore
from AppKit import NSWorkspace  # type: ignore

ATTR = {
    "role": AS.kAXRoleAttribute,
    "subrole": AS.kAXSubroleAttribute,
    "title": AS.kAXTitleAttribute,
    "desc": AS.kAXDescriptionAttribute,
    "value": AS.kAXValueAttribute,
    "help": AS.kAXHelpAttribute,
    "enabled": AS.kAXEnabledAttribute,
    "focused": AS.kAXFocusedAttribute,
    "position": AS.kAXPositionAttribute,
    "size": AS.kAXSizeAttribute,
    "children": AS.kAXChildrenAttribute,
    "placeholder": "AXPlaceholderValue",
}
# papéis que valem a pena listar p/ o modelo (interativos ou com texto)
INTERESTING = {
    "AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuItem",
    "AXMenuButton", "AXLink", "AXTab", "AXSlider", "AXComboBox", "AXStaticText", "AXImage", "AXCell", "AXRow",
    "AXWindow", "AXSheet", "AXToolbar", "AXTextArea", "AXIncrementor", "AXDisclosureTriangle", "AXWebArea",
    "AXHeading", "AXMenuBarItem", "AXSearchField", "AXSecureTextField",
}

_last_snapshot: dict[int, Any] = {}


def _same(a, b) -> bool:
    try:
        return bool(a == b) or (_point(_attr(a, "position")) == _point(_attr(b, "position")) and _text(_attr(a, "title")) == _text(_attr(b, "title")))
    except Exception:
        return False


def frontmost_app() -> dict:
    app = NSWorkspace.sharedWorkspace().frontmostApplication()
    if app is None:
        return {"name": "", "localized": "", "pid": 0, "bundle": ""}
    # `name` = nome do bundle (TextEdit) — estável p/ allowlist; `localized` = o que a UI mostra
    # ("Editor de Texto" em pt-BR). Sem isso a allowlist falhava em Macs em português.
    url = app.bundleURL()
    exe = str(url.lastPathComponent()) if url is not None else ""
    name = exe[:-4] if exe.endswith(".app") else (exe or str(app.localizedName() or ""))
    return {"name": name, "localized": str(app.localizedName() or ""), "pid": int(app.processIdentifier()), "bundle": str(app.bundleIdentifier() or "")}


def _attr(el, name: str):
    err, val = AS.AXUIElementCopyAttributeValue(el, ATTR[name], None)
    return val if err == 0 else None


def _point(v) -> tuple[float, float] | None:
    if v is None:
        return None
    ok, p = AS.AXValueGetValue(v, AS.kAXValueCGPointType, None)
    return (float(p.x), float(p.y)) if ok else None


def _size(v) -> tuple[float, float] | None:
    if v is None:
        return None
    ok, s = AS.AXValueGetValue(v, AS.kAXValueCGSizeType, None)
    return (float(s.width), float(s.height)) if ok else None


def _text(v) -> str:
    if v is None:
        return ""
    try:
        s = str(v)
    except Exception:
        return ""
    return re.sub(r"\s+", " ", s).strip()[:120]


def _actions(el) -> list[str]:
    err, names = AS.AXUIElementCopyActionNames(el, None)
    return [str(n) for n in names] if err == 0 and names else []


def tree(max_nodes: int = 400, max_depth: int = 10) -> dict:
    """Árvore achatada do app em foco: lista de nós com id, papel, rótulo, posição (pontos),
    tamanho, ações e profundidade. Guarda os elementos p/ `act(id)` agir depois."""
    global _last_snapshot
    app = frontmost_app()
    if not app["pid"]:
        return {"app": app, "nodes": [], "truncated": False}
    root = AS.AXUIElementCreateApplication(app["pid"])
    nodes: list[dict] = []
    snapshot: dict[int, Any] = {}
    truncated = False
    # Ordem que importa p/ o agente: janela em FOCO primeiro, depois as outras janelas, e por
    # último os itens da barra de menus (só o nível de cima: 300+ itens de submenu esgotavam o
    # teto de nós antes de chegar ao documento — bug real no TextEdit, 11/10).
    roots: list[tuple[Any, int]] = []
    err, fw = AS.AXUIElementCopyAttributeValue(root, AS.kAXFocusedWindowAttribute, None)
    focused = fw if err == 0 else None
    err, wins = AS.AXUIElementCopyAttributeValue(root, AS.kAXWindowsAttribute, None)
    windows = list(wins) if err == 0 and wins else []
    ordered = ([focused] if focused is not None else []) + [w for w in windows if focused is None or not _same(w, focused)]
    for w in reversed(ordered):
        roots.append((w, 1))
    err, mb = AS.AXUIElementCopyAttributeValue(root, AS.kAXMenuBarAttribute, None)
    menubar_items = list(_attr(mb, "children") or []) if err == 0 and mb is not None else []
    stack: list[tuple[Any, int]] = [(m, 99) for m in reversed(menubar_items)] + roots  # 99 = não descer
    while stack:
        el, depth = stack.pop()
        if len(nodes) >= max_nodes:
            truncated = True
            break
        role = _text(_attr(el, "role"))
        title = _text(_attr(el, "title"))
        desc = _text(_attr(el, "desc"))
        value = _attr(el, "value")
        val = _text(value) if isinstance(value, (str, int, float)) or value is None else ""
        placeholder = _text(_attr(el, "placeholder"))
        label = title or desc or placeholder or val
        pos = _point(_attr(el, "position"))
        size = _size(_attr(el, "size"))
        acts = _actions(el)
        if role in INTERESTING and (label or "AXPress" in acts or role in ("AXTextField", "AXTextArea", "AXWindow")):
            nid = len(nodes) + 1
            snapshot[nid] = el
            nodes.append({
                "id": nid, "depth": 0 if depth == 99 else depth, "role": role.replace("AX", ""), "label": label[:80],
                "value": val[:80] if val and val != label else "",
                "pos": [round(pos[0]), round(pos[1])] if pos else None,
                "size": [round(size[0]), round(size[1])] if size else None,
                "actions": [a.replace("AX", "") for a in acts if a not in ("AXShowMenu", "AXScrollToVisible")],
                "enabled": _attr(el, "enabled") is not False,
            })
        if depth < max_depth and role not in ("AXMenu", "AXMenuBar"):
            children = _attr(el, "children") or []
            for ch in reversed(list(children)[:60]):
                stack.append((ch, depth + 1))
    _last_snapshot = snapshot
    return {"app": app, "nodes": nodes, "truncated": truncated}


def find(label: str, role: str | None = None) -> list[int]:
    """ids do último snapshot cujo rótulo contém `label` (case-insensitive)."""
    t = tree()
    lab = label.lower()
    return [n["id"] for n in t["nodes"] if lab in n["label"].lower() and (role is None or n["role"].lower() == role.lower())]


def act(node_id: int, action: str = "Press", value: str | None = None) -> dict:
    el = _last_snapshot.get(int(node_id))
    if el is None:
        raise ValueError(f"nó {node_id} não existe no último snapshot — leia a árvore de novo")
    if action.lower() in ("setvalue", "set_value", "type"):
        err = AS.AXUIElementSetAttributeValue(el, AS.kAXValueAttribute, value or "")
        if err != 0:
            raise RuntimeError(f"AXUIElementSetAttributeValue falhou ({err})")
        return {"ok": True, "action": "SetValue"}
    name = action if action.startswith("AX") else f"AX{action}"
    err = AS.AXUIElementPerformAction(el, name)
    if err != 0:
        raise RuntimeError(f"ação {name} falhou ({err}); ações disponíveis: {_actions(el)}")
    return {"ok": True, "action": name}


def center(node_id: int) -> tuple[float, float] | None:
    el = _last_snapshot.get(int(node_id))
    if el is None:
        return None
    p, s = _point(_attr(el, "position")), _size(_attr(el, "size"))
    if not p or not s:
        return None
    return (p[0] + s[0] / 2, p[1] + s[1] / 2)
