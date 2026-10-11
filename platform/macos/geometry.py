# platform/macos/geometry.py — Retina: o screenshot sai em pixels (2x); o modelo enxerga e
# responde numa resolução LÓGICA fixa; os eventos Quartz usam PONTOS do display. Tudo aqui é
# função pura (testável sem tela).
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DisplayGeometry:
    origin_x: float  # canto do display em pontos (coordenadas globais)
    origin_y: float
    width_pt: float  # tamanho do display em pontos
    height_pt: float
    scale: float  # pixels por ponto (2.0 no Retina)
    logical_width: int  # largura que o modelo vê

    @property
    def logical_height(self) -> int:
        return max(1, round(self.height_pt * self.logical_width / self.width_pt))

    @property
    def pixel_width(self) -> int:
        return round(self.width_pt * self.scale)

    @property
    def pixel_height(self) -> int:
        return round(self.height_pt * self.scale)

    def logical_to_points(self, x: float, y: float) -> tuple[float, float]:
        """coordenada que o modelo deu (no screenshot lógico) → ponto global do display."""
        f = self.width_pt / self.logical_width
        return (self.origin_x + x * f, self.origin_y + y * f)

    def points_to_logical(self, px: float, py: float) -> tuple[float, float]:
        f = self.logical_width / self.width_pt
        return ((px - self.origin_x) * f, (py - self.origin_y) * f)

    def clamp_logical(self, x: float, y: float) -> tuple[float, float]:
        return (min(max(x, 0), self.logical_width - 1), min(max(y, 0), self.logical_height - 1))


def pick_logical_width(width_pt: float, requested: int) -> int:
    """nunca amplia: se o display é menor que o pedido, usa o tamanho real em pontos."""
    return int(min(requested, round(width_pt)))
