"""Icones desenhados em vetor (Pillow) - sem emoji, sem arquivos de imagem externos.

Tudo e desenhado em alta resolucao e reduzido com anti-serrilhado, entao fica
nitido tanto num botao pequeno quanto no icone do programa/bandeja.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

SUPERSAMPLE = 4


def _canvas(size: int):
    return Image.new("RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), (0, 0, 0, 0))


def _finish(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def play(size: int = 16, color: str = "#1a7f37") -> Image.Image:
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    pad = w * 0.24
    d.polygon([(pad, pad * 0.85), (pad, h - pad * 0.85), (w - pad * 0.75, h / 2)], fill=color)
    return _finish(img, size)


def stop(size: int = 16, color: str = "#cf222e") -> Image.Image:
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    pad = w * 0.26
    d.rounded_rectangle([pad, pad, w - pad, h - pad], radius=w * 0.1, fill=color)
    return _finish(img, size)


def record(size: int = 16, color: str = "#cf222e") -> Image.Image:
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    cx, cy, r = w / 2, h / 2, w * 0.36
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    return _finish(img, size)


def camera(size: int = 16, color: str = "#57606a") -> Image.Image:
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    body_top = h * 0.32
    d.rounded_rectangle([w * 0.08, body_top, w * 0.92, h * 0.86], radius=w * 0.08, fill=color)
    bump_w, bump_h = w * 0.28, h * 0.12
    d.rounded_rectangle(
        [w / 2 - bump_w / 2, body_top - bump_h * 0.7, w / 2 + bump_w / 2, body_top + bump_h * 0.3],
        radius=bump_h * 0.3, fill=color,
    )
    cx, cy, r = w / 2, (body_top + h * 0.86) / 2 + h * 0.02, w * 0.19
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(0, 0, 0, 0))
    d.ellipse([cx - r * 0.72, cy - r * 0.72, cx + r * 0.72, cy + r * 0.72], fill=color)
    return _finish(img, size)


def refresh(size: int = 16, color: str = "#1f6feb") -> Image.Image:
    """Setas circulares - icone universal de 'verificar/atualizar'."""
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    cx, cy, r = w / 2, h / 2, w * 0.33
    width = max(2 * SUPERSAMPLE, int(w * 0.14))
    start_deg, end_deg = -125, 155
    d.arc([cx - r, cy - r, cx + r, cy + r], start=start_deg, end=end_deg, fill=color, width=width)

    tip_ang = math.radians(end_deg)
    tip = (cx + r * math.cos(tip_ang), cy + r * math.sin(tip_ang))
    tang = tip_ang + math.pi / 2  # direcao tangente (sentido do arco)
    side = w * 0.15
    back = (tip[0] - side * math.cos(tang), tip[1] - side * math.sin(tang))
    p1 = (back[0] + side * 0.62 * math.cos(tip_ang), back[1] + side * 0.62 * math.sin(tip_ang))
    p2 = (back[0] - side * 0.62 * math.cos(tip_ang), back[1] - side * 0.62 * math.sin(tip_ang))
    d.polygon([tip, p1, p2], fill=color)
    return _finish(img, size)


def wifi(size: int = 16, color: str = "#1f6feb") -> Image.Image:
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    cx, cy = w / 2, h * 0.8
    r_dot = w * 0.075
    d.ellipse([cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot], fill=color)
    width = max(2 * SUPERSAMPLE, int(w * 0.1))
    for frac in (0.34, 0.58, 0.82):
        r = w * frac
        d.arc([cx - r, cy - r, cx + r, cy + r], start=205, end=335, fill=color, width=width)
    return _finish(img, size)


def gear(size: int = 16, color: str = "#57606a") -> Image.Image:
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    cx, cy = w / 2, h / 2
    outer_r, inner_r, hole_r = w * 0.46, w * 0.34, w * 0.17
    teeth = 8
    points = []
    for i in range(teeth * 2):
        angle = math.pi * 2 * i / (teeth * 2)
        r = outer_r if i % 2 == 0 else inner_r
        points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    d.polygon(points, fill=color)
    d.ellipse([cx - hole_r, cy - hole_r, cx + hole_r, cy + hole_r], fill=(0, 0, 0, 0))
    return _finish(img, size)


def app_icon(size: int = 256, bg: str = "#1f6feb", fg: str = "#ffffff") -> Image.Image:
    """Telefone com um botao de 'play' dentro - representa espelhar/tocar a tela."""
    img = _canvas(size)
    d = ImageDraw.Draw(img)
    w, h = img.size
    d.rounded_rectangle([0, 0, w, h], radius=w * 0.22, fill=bg)

    pw, ph = w * 0.34, h * 0.62
    px, py = (w - pw) / 2, (h - ph) / 2
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=pw * 0.18, fill=fg)

    bezel_x, bezel_top, bezel_bottom = pw * 0.09, ph * 0.09, ph * 0.13
    d.rounded_rectangle(
        [px + bezel_x, py + bezel_top, px + pw - bezel_x, py + ph - bezel_bottom],
        radius=pw * 0.12, fill=bg,
    )

    cx, cy = px + pw / 2, py + ph / 2 - ph * 0.02
    tri = pw * 0.36
    d.polygon(
        [(cx - tri * 0.32, cy - tri * 0.46), (cx - tri * 0.32, cy + tri * 0.46), (cx + tri * 0.55, cy)],
        fill=fg,
    )
    return _finish(img, size)


def save_app_ico(path: Path):
    base = app_icon(256)
    base.save(path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (128, 128), (256, 256)])


if __name__ == "__main__":
    save_app_ico(Path(__file__).resolve().parent / "mirrorpanel.ico")
    print("icone gerado")
