import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from macos.geometry import DisplayGeometry, pick_logical_width  # noqa: E402


def test_retina_roundtrip():
    g = DisplayGeometry(0, 0, 1512, 982, 2.0, 1440)
    assert g.pixel_width == 3024 and g.pixel_height == 1964
    assert g.logical_height == 935
    px, py = g.logical_to_points(720, 467.5)
    assert abs(px - 756) < 0.01 and abs(py - 490.9) < 0.1
    lx, ly = g.points_to_logical(px, py)
    assert abs(lx - 720) < 1e-6 and abs(ly - 467.5) < 1e-6


def test_secondary_display_offset():
    g = DisplayGeometry(1512, -200, 1920, 1080, 1.0, 1440)
    assert g.logical_to_points(0, 0) == (1512, -200)
    x, y = g.logical_to_points(1440, 810)
    assert abs(x - 3432) < 1e-6 and abs(y - 880) < 1e-6


def test_pick_logical_width_never_upscales():
    assert pick_logical_width(1512, 1440) == 1440
    assert pick_logical_width(1280, 1440) == 1280


def test_clamp():
    g = DisplayGeometry(0, 0, 1512, 982, 2.0, 1440)
    assert g.clamp_logical(-5, 99999) == (0, g.logical_height - 1)
