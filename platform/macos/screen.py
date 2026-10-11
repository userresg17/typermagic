# platform/macos/screen.py — captura do display e redução p/ a resolução lógica.
# Ordem: ScreenCaptureKit (macOS 14+, via pyobjc) → fallback `screencapture -x -R` (CLI do sistema).
# Saída: PNG base64 já na resolução LÓGICA (ex.: 1440 px de largura) + geometria p/ converter
# coordenadas de volta (geometry.py). Só o display configurado (main ou índice).
from __future__ import annotations

import base64
import os
import subprocess
import tempfile
import threading

import Quartz  # type: ignore
from Foundation import NSMutableData  # type: ignore

from .geometry import DisplayGeometry, pick_logical_width


def display_id(selector: str = "main") -> int:
    if selector in ("", "main"):
        return Quartz.CGMainDisplayID()
    err, ids, _n = Quartz.CGGetActiveDisplayList(16, None, None)
    idx = int(selector)
    if err != 0 or idx >= len(ids):
        raise ValueError(f"display {selector} não existe ({len(ids) if ids else 0} ativos)")
    return ids[idx]


def geometry(selector: str = "main", logical_width: int = 1440) -> DisplayGeometry:
    did = display_id(selector)
    b = Quartz.CGDisplayBounds(did)
    mode = Quartz.CGDisplayCopyDisplayMode(did)
    px_w = Quartz.CGDisplayModeGetPixelWidth(mode)
    scale = px_w / b.size.width if b.size.width else 1.0
    return DisplayGeometry(
        origin_x=b.origin.x,
        origin_y=b.origin.y,
        width_pt=b.size.width,
        height_pt=b.size.height,
        scale=scale,
        logical_width=pick_logical_width(b.size.width, logical_width),
    )


def _capture_sck(did: int, timeout: float = 4.0):
    """ScreenCaptureKit: devolve CGImage do display inteiro ou lança."""
    import ScreenCaptureKit as SCK  # type: ignore

    done = threading.Event()
    box: dict = {}

    def on_content(content, err):
        if err is not None or content is None:
            box["err"] = err or "sem conteúdo"
            done.set()
            return
        disp = next((d for d in content.displays() if d.displayID() == did), None)
        if disp is None:
            box["err"] = "display não está no conteúdo compartilhável"
            done.set()
            return
        flt = SCK.SCContentFilter.alloc().initWithDisplay_excludingWindows_(disp, [])
        cfg = SCK.SCStreamConfiguration.alloc().init()
        cfg.setWidth_(int(disp.width() * 2))
        cfg.setHeight_(int(disp.height() * 2))
        cfg.setShowsCursor_(True)

        def on_image(img, err2):
            if err2 is not None:
                box["err"] = err2
            else:
                box["img"] = img
            done.set()

        SCK.SCScreenshotManager.captureImageWithFilter_configuration_completionHandler_(flt, cfg, on_image)

    SCK.SCShareableContent.getShareableContentWithCompletionHandler_(on_content)
    if not done.wait(timeout):
        raise TimeoutError("ScreenCaptureKit não respondeu")
    if "img" not in box:
        raise RuntimeError(f"ScreenCaptureKit falhou: {box.get('err')}")
    return box["img"]


def _capture_cli(g: DisplayGeometry):
    """Fallback: `screencapture -x -R x,y,w,h` (pontos globais) → CGImage."""
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        region = f"{int(g.origin_x)},{int(g.origin_y)},{int(g.width_pt)},{int(g.height_pt)}"
        r = subprocess.run(["/usr/sbin/screencapture", "-x", "-t", "png", "-R", region, path], capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            raise RuntimeError(f"screencapture falhou: {r.stderr.strip()}")
        url = Quartz.CFURLCreateWithFileSystemPath(None, path, Quartz.kCFURLPOSIXPathStyle, False)
        src = Quartz.CGImageSourceCreateWithURL(url, None)
        img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None) if src else None
        if img is None:
            raise RuntimeError("screencapture não produziu imagem")
        return img
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _downscale_png(img, width: int, height: int) -> bytes:
    cs = Quartz.CGColorSpaceCreateDeviceRGB()
    ctx = Quartz.CGBitmapContextCreate(None, width, height, 8, width * 4, cs, Quartz.kCGImageAlphaPremultipliedLast)
    Quartz.CGContextSetInterpolationQuality(ctx, Quartz.kCGInterpolationHigh)
    Quartz.CGContextDrawImage(ctx, Quartz.CGRectMake(0, 0, width, height), img)
    out = Quartz.CGBitmapContextCreateImage(ctx)
    data = NSMutableData.data()
    dest = Quartz.CGImageDestinationCreateWithData(data, "public.png", 1, None)
    Quartz.CGImageDestinationAddImage(dest, out, None)
    Quartz.CGImageDestinationFinalize(dest)
    return bytes(data)


def screenshot(selector: str = "main", logical_width: int = 1440, prefer: str = "sck") -> dict:
    g = geometry(selector, logical_width)
    did = display_id(selector)
    backend = "sck"
    img = None
    if prefer == "sck":
        try:
            img = _capture_sck(did)
        except Exception as e:  # cai p/ o CLI, registrando o motivo
            backend = f"cli (sck: {str(e)[:80]})"
    if img is None:
        img = _capture_cli(g)
        if backend == "sck":
            backend = "cli"
    png = _downscale_png(img, g.logical_width, g.logical_height)
    return {
        "png_base64": base64.b64encode(png).decode(),
        "width": g.logical_width,
        "height": g.logical_height,
        "scale": g.scale,
        "display_pt": [g.width_pt, g.height_pt],
        "backend": backend,
    }
