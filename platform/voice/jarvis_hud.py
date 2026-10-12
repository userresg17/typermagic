#!/usr/bin/env python3
"""HUD do Jarvis: pílula preta 50% transparente com uma linha no meio e uma onda de áudio que
acompanha a fala. Sem texto, sem ícone, sem botão. Fica no topo da tela onde está o mouse, não
rouba foco e o clique passa através.

Controle por JSON no stdin:
  {"state":"listening"}               aparece; a onda segue o nível do microfone ({"level":0..1})
  {"state":"thinking"}                onda calma, respirando
  {"state":"speaking","wav":"/x.wav"} onda segue o envelope do áudio que está tocando agora
  {"state":"done"} | {"state":"error"} some (suave)
  {"level":0.3}                       nível do microfone (enquanto ouve)
"""

from __future__ import annotations

import array
import json
import math
import sys
import threading
import time
import wave

import AppKit
import Foundation
import objc
from PyObjCTools import AppHelper

W, H = 230.0, 46.0
N = 64  # pontos da onda
FPS = 60.0


def envelope(path: str, step_s: float = 1 / FPS) -> list[float]:
    """nível (0..1) a cada 1/60 s do WAV — só biblioteca padrão."""
    try:
        with wave.open(path, "rb") as w:
            sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            raw = w.readframes(n)
    except Exception:
        return []
    if sw != 2:
        return []
    a = array.array("h", raw)
    if ch > 1:
        a = a[::ch]
    hop = max(1, int(sr * step_s))
    env = []
    for i in range(0, len(a), hop):
        blk = a[i : i + hop : 4]
        if not blk:
            break
        env.append(math.sqrt(sum(x * x for x in blk) / len(blk)) / 32768.0)
    peak = max(env) if env else 1.0
    return [min(1.0, e / (peak or 1.0)) for e in env]


class Wave(AppKit.NSView):
    def initWithFrame_(self, f):
        self = objc.super(Wave, self).initWithFrame_(f)
        self.hist = [0.0] * N
        self.phase = 0.0
        return self

    def isOpaque(self):
        return False

    def drawRect_(self, _r):
        b = self.bounds()
        w, h = b.size.width, b.size.height
        mid = h / 2
        pad = 18.0
        # linha do meio
        AppKit.NSColor.colorWithWhite_alpha_(1.0, 0.35).set()
        line = AppKit.NSBezierPath.bezierPath()
        line.moveToPoint_((pad, mid))
        line.lineToPoint_((w - pad, mid))
        line.setLineWidth_(1.0)
        line.stroke()
        # onda espelhada em torno da linha, afinando nas pontas
        span = w - 2 * pad
        amp = h * 0.40
        top, bot = [], []
        for i, v in enumerate(self.hist):
            x = pad + span * i / (N - 1)
            taper = math.sin(math.pi * i / (N - 1)) ** 0.8
            y = max(0.0, v) * amp * taper
            top.append((x, mid + y))
            bot.append((x, mid - y))
        path = AppKit.NSBezierPath.bezierPath()
        path.moveToPoint_(top[0])
        for i in range(1, len(top)):
            (x0, y0), (x1, y1) = top[i - 1], top[i]
            path.curveToPoint_controlPoint1_controlPoint2_((x1, y1), ((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1))
        for i in range(len(bot) - 1, 0, -1):
            (x0, y0), (x1, y1) = bot[i], bot[i - 1]
            path.curveToPoint_controlPoint1_controlPoint2_((x1, y1), ((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1))
        path.closePath()
        AppKit.NSColor.colorWithWhite_alpha_(1.0, 0.85).set()
        path.fill()


class Hud(AppKit.NSObject):
    def init(self):
        self = objc.super(Hud, self).init()
        self.win = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            Foundation.NSMakeRect(0, 0, W, H),
            AppKit.NSWindowStyleMaskBorderless | AppKit.NSWindowStyleMaskNonactivatingPanel,
            AppKit.NSBackingStoreBuffered,
            False,
        )
        self.win.setLevel_(AppKit.NSStatusWindowLevel)
        self.win.setOpaque_(False)
        self.win.setBackgroundColor_(AppKit.NSColor.clearColor())
        self.win.setIgnoresMouseEvents_(True)
        self.win.setHasShadow_(False)
        self.win.setCollectionBehavior_(
            AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
            | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary
            | AppKit.NSWindowCollectionBehaviorStationary
        )
        pill = AppKit.NSView.alloc().initWithFrame_(Foundation.NSMakeRect(0, 0, W, H))
        pill.setWantsLayer_(True)
        pill.layer().setBackgroundColor_(AppKit.NSColor.colorWithWhite_alpha_(0.0, 0.5).CGColor())
        pill.layer().setCornerRadius_(H / 2)
        self.wave = Wave.alloc().initWithFrame_(Foundation.NSMakeRect(0, 0, W, H))
        pill.addSubview_(self.wave)
        self.win.setContentView_(pill)
        self.state = "hidden"
        self.mic = 0.0
        self.env = []
        self.env_t0 = 0.0
        self.level = 0.0
        self.hide_at = 0.0
        self.timer = Foundation.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(1 / FPS, self, "tick:", None, True)
        return self

    @objc.python_method
    def place(self):
        m = AppKit.NSEvent.mouseLocation()
        scr = next((s for s in AppKit.NSScreen.screens() if Foundation.NSPointInRect(m, s.frame())), AppKit.NSScreen.mainScreen())
        f = scr.visibleFrame()
        self.win.setFrameOrigin_(Foundation.NSMakePoint(f.origin.x + (f.size.width - W) / 2, f.origin.y + f.size.height - H - 12))

    def apply_(self, msg):
        if "level" in msg and "state" not in msg:
            self.mic = max(0.0, min(1.0, float(msg["level"])))
            return
        st = msg.get("state", "thinking")
        if st in ("done", "error"):
            if self.state != "hidden":
                self.state = "fading"
                self.hide_at = time.time() + 0.5
            return
        if self.state == "hidden":
            self.place()
            self.win.setAlphaValue_(0.0)
            self.win.orderFrontRegardless()
        self.state = st
        if st == "speaking" and msg.get("wav"):
            self.env = envelope(msg["wav"])
            self.env_t0 = time.time()

    def tick_(self, _t):
        if self.state == "hidden":
            return
        now = time.time()
        if self.state == "listening":
            target = min(1.0, self.mic * 4.0)
        elif self.state == "speaking":
            i = int((now - self.env_t0) * FPS)
            target = self.env[i] if 0 <= i < len(self.env) else 0.0
        elif self.state == "thinking":
            target = 0.16 + 0.10 * math.sin(now * 3.2)
        else:
            target = 0.0
        self.level += (target - self.level) * 0.35
        self.wave.phase += 0.25
        jitter = 0.85 + 0.15 * math.sin(self.wave.phase)
        self.wave.hist = self.wave.hist[1:] + [self.level * jitter]
        self.wave.setNeedsDisplay_(True)
        a = self.win.alphaValue()
        if self.state == "fading":
            self.win.setAlphaValue_(max(0.0, a - 0.08))
            if now >= self.hide_at and self.win.alphaValue() <= 0.01:
                self.win.orderOut_(None)
                self.state = "hidden"
                self.wave.hist = [0.0] * N
                self.level = 0.0
        elif a < 1.0:
            self.win.setAlphaValue_(min(1.0, a + 0.12))


def main() -> None:
    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
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
