"""Generate 1170x2532 PNG: mid-game player view (filled grid, marks, pattern hint).

Run: python export_physical_ref.py
Requires: Pillow
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1170, 2532
S = W / 390.0
GREEN = (0, 255, 136)
GREEN_DIM = (0, 200, 110)
GRID_BORDER = (0, 220, 150)
CELL_BG = (35, 35, 38)
CELL_MARKED = (0, 72, 52)
CHROME_BG = (42, 42, 42)
GOLD = (255, 200, 90)
TEXT = (245, 245, 245)
TEXT_DIM = (180, 185, 192)

# Mid-game: titles showing; host has played ~18 songs; player marking toward a line pattern
SONGS = [
    "Blinding\nLights",
    "As It\nWas",
    "Levitating",
    "About\nDamn Time",
    "Flowers",
    "Anti-\nHero",
    "Heat\nWaves",
    "Good\n4 U",
    "Stay",
    "Shivers",
    "Industry\nBaby",
    "Peaches",
    "Bad\nHabits",
    "Kiss Me\nMore",
    "Montero",
    "Save Your\nTears",
    "Watermelon\nSugar",
    "Don't Start\nNow",
    "Circles",
    "Positions",
    "Rockstar",
    "drivers\nlicense",
    "Butter",
    "Mood",
    "Savage",
]

# Marked = heard & tapped (song played)
MARKED = {
    (0, 0),
    (0, 2),
    (1, 1),
    (2, 0),
    (2, 1),
    (2, 2),
    (2, 4),
    (3, 2),
    (3, 4),
    (4, 1),
}
# Middle row pattern hint (e.g. “any line” host pattern — visual cue on row 2)
PATTERN = {(2, 0), (2, 1), (2, 2), (2, 3), (2, 4)}


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_cell_text(
    dr: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
) -> None:
    x1, y1, x2, y2 = box
    lines = text.split("\n")
    line_heights = []
    for ln in lines:
        bbox = dr.textbbox((0, 0), ln, font=font)
        line_heights.append(bbox[3] - bbox[1])
    gap = 2
    total_h = sum(line_heights) + gap * (len(lines) - 1) if lines else 0
    cy = y1 + max(4, (y2 - y1 - total_h) // 2)
    for ln, lh in zip(lines, line_heights):
        bbox = dr.textbbox((0, 0), ln, font=font)
        tw = bbox[2] - bbox[0]
        x = x1 + max(2, (x2 - x1 - tw) // 2)
        dr.text((x, cy), ln, fill=fill, font=font)
        cy += lh + gap


def main() -> None:
    out_dir = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(out_dir, "player-physical-ref-1170x2532.png")
    img = Image.new("RGB", (W, H), "#080808")
    dr = ImageDraw.Draw(img)
    f_lg = load_font(int(15 * S))
    f_md = load_font(int(13 * S))
    f_sm = load_font(int(11 * S))
    f_xs = load_font(int(10 * S))
    f_cell = load_font(max(14, int(7 * S)))  # ~21px — readable in cell

    sb_h = 162
    dr.rectangle([0, 0, W, sb_h], fill="#000")
    dr.text((24, 48), "9:41", fill="#fff", font=f_md)
    dr.text((W - 130, 48), "100%", fill="#ddd", font=f_sm)

    y = sb_h + 24
    mx = 36
    hdr_h = 200
    dr.rounded_rectangle([mx, y, W - mx, y + hdr_h], radius=12, outline=GRID_BORDER, width=2, fill=CHROME_BG)
    iy = y + 18
    dr.text((mx + 20, iy), "Jordan", fill="#e8e8e8", font=f_lg)
    pill_w, pill_h = 160, 44
    px2 = W - mx - pill_w - 16
    dr.rounded_rectangle([px2, iy - 4, px2 + pill_w, iy - 4 + pill_h], radius=22, fill=(0, 90, 45), outline=GREEN)
    dr.ellipse([px2 + 12, iy + 6, px2 + 28, iy + 22], fill=GREEN)
    dr.text((px2 + 38, iy + 4), "Resync", fill="#ddeedd", font=f_sm)
    iy2 = iy + 52
    dr.line([mx + 16, iy2, W - mx - 16, iy2], fill=(80, 80, 85))
    iy2 += 14
    dr.text((mx + 20, iy2), "12 players · 18 played", fill="#9aa0a6", font=f_sm)
    dr.text((W - mx - 120, iy2), "BINGO!", fill=GREEN, font=f_sm)
    y += hdr_h + 12

    ctrl_h = 130
    dr.rounded_rectangle([mx, y, W - mx, y + ctrl_h], radius=12, outline=GRID_BORDER, width=2, fill=CHROME_BG)
    cy = y + 22
    dr.text((mx + 20, cy), "Display", fill="#b3b3b3", font=f_sm)
    dr.text((W - mx - 240, cy), "Title", fill=TEXT_DIM, font=f_sm)
    dr.text((W - mx - 95, cy), "Artist", fill="#888", font=f_sm)
    tw, th = 51, 29
    tx = W - mx - 200
    dr.rounded_rectangle([tx, cy - 2, tx + tw, cy - 2 + th], radius=14, fill=(60, 60, 65), outline="#555")
    dr.ellipse([tx + 4, cy + 1, tx + 24, cy + 25], fill="#fff")

    cy2 = y + 78
    dr.text((mx + 20, cy2), "Text size", fill="#b3b3b3", font=f_sm)
    bx = W - mx - 220
    dr.rounded_rectangle([bx, cy2 - 4, bx + 44, cy2 + 34], outline="#666")
    dr.text((bx + 16, cy2 + 2), "\u2212", fill="#fff", font=f_md)
    dr.text((bx + 54, cy2 + 6), "100%", fill="#b3b3b3", font=f_sm)
    dr.rounded_rectangle([bx + 118, cy2 - 4, bx + 162, cy2 + 34], outline="#666")
    dr.text((bx + 132, cy2 + 2), "+", fill="#fff", font=f_md)
    y += ctrl_h + 12

    bottom_reserve = 280
    avail_h = H - y - bottom_reserve
    avail_w = W - 2 * mx
    side = min(avail_w, avail_h)
    x0 = (W - side) // 2
    y0 = y + max(0, (avail_h - side) // 2)
    dr.rounded_rectangle([x0, y0, x0 + side, y0 + side], radius=14, outline=GRID_BORDER, width=3, fill="#1a1a1e")

    cell = side // 5
    pad = max(2, cell // 40)

    for idx, title in enumerate(SONGS):
        row, col = idx // 5, idx % 5
        cx = x0 + col * cell
        cy = y0 + row * cell
        inner = [cx + pad, cy + pad, cx + cell - pad, cy + cell - pad]

        if (row, col) in MARKED:
            dr.rectangle(inner, outline=GRID_BORDER, width=1, fill=CELL_MARKED)
            dr.rectangle(
                [inner[0] + 2, inner[1] + 2, inner[2] - 2, inner[3] - 2],
                outline=GREEN,
                width=2,
            )
        else:
            dr.rectangle(inner, outline=GRID_BORDER, width=1, fill=CELL_BG)

        if (row, col) in PATTERN:
            dr.rectangle(
                [inner[0] - 1, inner[1] - 1, inner[2] + 1, inner[3] + 1],
                outline=GOLD,
                width=2,
            )

        text_box = [inner[0] + 4, inner[1] + 4, inner[2] - 4, inner[3] - 14]
        draw_cell_text(dr, title, text_box, f_cell, TEXT)

        if (row, col) in MARKED:
            dot_r = 5
            dr.ellipse(
                [inner[2] - 10 - dot_r, inner[1] + 6 - dot_r, inner[2] - 10 + dot_r, inner[1] + 6 + dot_r],
                fill=GREEN,
                outline=GREEN_DIM,
            )

    fab_r = 135
    fcx = W - mx - fab_r
    fcy = H - 50 - fab_r
    dr.ellipse([fcx - fab_r, fcy - fab_r, fcx + fab_r, fcy + fab_r], fill=GREEN, outline=GREEN_DIM, width=2)
    dr.text((fcx - 42, fcy - 28), "BINGO", fill="#061a12", font=f_xs)
    dr.text((fcx - 38, fcy - 6), "READY!", fill="#061a12", font=f_xs)

    hi_w, hi_h = 402, 15
    hx = (W - hi_w) // 2
    hy = H - 24 - hi_h
    dr.rounded_rectangle([hx, hy, hx + hi_w, hy + hi_h], radius=4, fill="#ffffff55")

    img.save(out, "PNG", optimize=True)
    print(out)


if __name__ == "__main__":
    main()
