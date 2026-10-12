#!/usr/bin/env python3
"""Caixinha flutuante do Jarvis (HUD): mostra na tela o que ele está fazendo.

Janela sem borda, translúcida, no topo-centro da tela, por cima de tudo, que NÃO rouba o foco
nem recebe clique (o mouse passa através). Controlada por JSON no stdin:
  {"state":"listening"|"thinking"|"speaking"|"done"|"error", "text":"..."}
"done" some com a caixa depois de 1,5 s. Fechar o stdin encerra.
"""

from __future__ import annotations

import json
import sys
import threading

import AppKit
import Foundation
import objc
from PyObjCTools import AppHelper

W, H = 460.0, 64.0

STYLE = {
    "listening": ("🎙️  Ouvindo…", (0.16, 0.50, 0.95)),
    "thinking": ("⏳  Processando…", (0.95, 0.62, 0.10)),
    "speaking": ("🔊  Falando", (0.20, 0.72, 0.40)),
    "error": ("⚠️  Erro", (0.90, 0.25, 0.25)),
    "done": ("✓  Pronto", (0.45, 0.45, 0.50)),
}


class Hud(AppKit.NSObject):
    def init(self):
        self = objc.super(Hud, self).init()
        scr = AppKit.NSScreen.mainScreen().visibleFrame()
        x = scr.origin.x + (scr.size.width - W) / 2
        y = scr.origin.y + scr.size.height - H - 14
        self.win = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            Foundation.NSMakeRect(x, y, W, H),
            AppKit.NSWindowStyleMaskBorderless | AppKit.NSWindowStyleMaskNonactivatingPanel,
            AppKit.NSBackingStoreBuffered,
            False,
        )
        self.win.setLevel_(AppKit.NSStatusWindowLevel)
        self.win.setOpaque_(False)
        self.win.setBackgroundColor_(AppKit.NSColor.clearColor())
        self.win.setIgnoresMouseEvents_(True)
        self.win.setHasShadow_(True)
        self.win.setCollectionBehavior_(
            AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary | AppKit.NSWindowCollectionBehaviorStationary
        )
        box = AppKit.NSVisualEffectView.alloc().initWithFrame_(Foundation.NSMakeRect(0, 0, W, H))
        box.setMaterial_(AppKit.NSVisualEffectMaterialHUDWindow)
        box.setBlendingMode_(AppKit.NSVisualEffectBlendingModeBehindWindow)
        box.setState_(AppKit.NSVisualEffectStateActive)
        box.setWantsLayer_(True)
        box.layer().setCornerRadius_(16)
        box.layer().setMasksToBounds_(True)
        self.win.setContentView_(box)

        self.dot = AppKit.NSView.alloc().initWithFrame_(Foundation.NSMakeRect(16, H / 2 - 6, 12, 12))
        self.dot.setWantsLayer_(True)
        self.dot.layer().setCornerRadius_(6)
        box.addSubview_(self.dot)

        self.title = self._label(Foundation.NSMakeRect(38, H - 30, W - 50, 20), 14, True)
        self.sub = self._label(Foundation.NSMakeRect(38, 8, W - 50, 20), 12, False)
        box.addSubview_(self.title)
        box.addSubview_(self.sub)
        self.hide_timer = None
        self.pulse = 0
        return self

    @objc.python_method
    def _label(self, rect, size, bold):
        t = AppKit.NSTextField.labelWithString_("")
        t.setFrame_(rect)
        t.setFont_(AppKit.NSFont.boldSystemFontOfSize_(size) if bold else AppKit.NSFont.systemFontOfSize_(size))
        t.setTextColor_(AppKit.NSColor.whiteColor() if bold else AppKit.NSColor.colorWithWhite_alpha_(0.85, 1))
        t.setLineBreakMode_(AppKit.NSLineBreakByTruncatingTail)
        return t

    def apply_(self, msg):
        state = msg.get("state", "thinking")
        label, rgb = STYLE.get(state, STYLE["thinking"])
        self.title.setStringValue_(msg.get("title") or label)
        self.sub.setStringValue_((msg.get("text") or "")[:120])
        self.dot.layer().setBackgroundColor_(AppKit.NSColor.colorWithRed_green_blue_alpha_(*rgb, 1).CGColor())
        if self.hide_timer is not None:
            self.hide_timer.invalidate()
            self.hide_timer = None
        self.win.setAlphaValue_(1.0)
        self._place()
        self.win.orderFrontRegardless()
        if state in ("done", "error"):
            self.hide_timer = Foundation.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                1.5 if state == "done" else 4.0, self, "hide:", None, False
            )

    @objc.python_method
    def _place(self):
        """topo-centro da tela onde está o MOUSE (é para onde o dono está olhando)."""
        m = AppKit.NSEvent.mouseLocation()
        scr = next((s for s in AppKit.NSScreen.screens() if Foundation.NSPointInRect(m, s.frame())), AppKit.NSScreen.mainScreen())
        f = scr.visibleFrame()
        self.win.setFrameOrigin_(Foundation.NSMakePoint(f.origin.x + (f.size.width - W) / 2, f.origin.y + f.size.height - H - 14))

    def hide_(self, _t):
        self.hide_timer = None
        self.win.orderOut_(None)


def main() -> None:
    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)  # sem ícone no Dock
    hud = Hud.alloc().init()

    def reader():
        for line in sys.stdin:
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            AppHelper.callAfter(hud.apply_, msg)
        AppHelper.callAfter(AppHelper.stopEventLoop)

    threading.Thread(target=reader, daemon=True).start()
    AppHelper.runEventLoop()


if __name__ == "__main__":
    main()
