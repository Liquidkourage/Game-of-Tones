"""Generate 1170x2532 PNG for full-screen phone size check. Run: python export_physical_ref.py"""
from __future__ import annotations
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1170, 2532
S = W / 390.0
GREEN = (0, 255, 136)
GRID_BORDER = (0, 220, 150)
CELL_BG = (35, 35, 38)
CHROME_BG = (42, 42, 42)

def load_font(size: int):
    for path in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(out_dir, "player-physical-ref-1170x2532.png")
    img = Image.new("RGB", (W, H), "#080808")
    dr = ImageDraw.Draw(img)
    f_lg = load_font(int(15 * S))
    f_md = load_font(int(13 * S))
    f_sm = load_font(int(11 * S))
    f_xs = load_font(int(10 * S))

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
    y += hdr_h + 12

    ctrl_h = 130
    dr.rounded_rectangle([mx, y, W - mx, y + ctrl_h], radius=12, outline=GRID_BORDER, width=2, fill=CHROME_BG)
    cy = y + 22
    dr.text((mx + 20, cy), "Display", fill="#b3b3b3", font=f_sm)
    dr.text((W - mx - 200, cy), "Artist", fill="#888", font=f_sm)
    tw, th = 51, 29
    tx = W - mx - 90
    dr.rounded_rectangle([tx, cy - 2, tx + tw, cy - 2 + th], radius=14, fill=GREEN)
    dr.ellipse([tx + tw - 25, cy + 1, tx + tw - 5, cy + 25], fill="#fff")
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
    for row in range(5):
        for col in range(5):
            cx, cy = x0 + col * cell, y0 + row * cell
            p = 2
            dr.rectangle([cx + p, cy + p, cx + cell - p, cy + cell - p], outline=GRID_BORDER, width=1, fill=CELL_BG)

    fab_r = 135
    fcx = W - mx - fab_r
    fcy = H - 50 - fab_r
    dr.ellipse([fcx - fab_r, fcy - fab_r, fcx + fab_r, fcy + fab_r], fill=GREEN, outline=(0, 200, 110), width=2)
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
