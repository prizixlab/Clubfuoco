#!/usr/bin/env python3
"""Render the Aashi Guest List lockup for the app's small logo slots.

    python3 scripts/make-aashi-logo.py

Writes transparent PNGs to public/pass-assets/:
    logo-aashi.png      160x32   wallet pass logo slot (matches logo-rumbalist)
    logo-aashi@2x.png   320x65
    logo-aashi@3x.png   480x98
    logo-aashi-hosted.png  640x130  for partner_brands.logo_url

Why a horizontal lockup and not the circular badge: every slot this lands in
is a thin strip — the booking sheet renders it at 12pt tall inside 84pt of
width, and Apple's pass logo slot is 160x50pt. A circular avatar scaled into
that becomes an unreadable dot, so the mark is re-laid-out as hearts + wordmark.

Transparent background, light-on-dark: the pass is dark, the checkout credit
sits on a dark sheet, and a baked-in black disc would show as a rectangle on
anything else.

NOTE: this is a faithful RENDITION built from the supplier's profile image,
not their master artwork. Ask Aashi for the original vector before anything
goes to print or to the App Store listing.
"""

import math
import pathlib
from PIL import Image, ImageDraw, ImageFont

RED = (229, 28, 36, 255)      # sampled from the supplier's mark
WHITE = (255, 255, 255, 255)
OUT = pathlib.Path('public/pass-assets')

BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
REG = '/System/Library/Fonts/Supplemental/Arial.ttf'


def heart_points(cx, cy, scale, n=220):
    """Classic parametric heart, centred on (cx, cy)."""
    pts = []
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * scale, cy - y * scale))
    return pts


def render(w, h):
    """Draw the lockup at 4x then downsample — gives clean antialiased strokes."""
    S = 4
    im = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    W, H = w * S, h * S

    # ── Hearts: one large, one smaller overlapping low-right (outline style) ──
    big_s = H / 46
    d.line(heart_points(H * 0.46, H * 0.42, big_s), fill=RED, width=max(2, int(H * 0.055)), joint='curve')
    small_s = big_s * 0.52
    d.line(heart_points(H * 0.78, H * 0.60, small_s), fill=RED, width=max(2, int(H * 0.05)), joint='curve')

    # ── Wordmark ─────────────────────────────────────────────────────────────
    text_x = H * 1.06
    aashi = ImageFont.truetype(BOLD, int(H * 0.46))
    d.text((text_x, H * 0.30), 'AASHI', font=aashi, fill=WHITE, anchor='lm')
    aw = d.textlength('AASHI', font=aashi)

    # "GUEST LIST" is letterspaced to the width of AASHI above it.
    sub_txt = 'GUEST LIST'
    sub = ImageFont.truetype(REG, int(H * 0.235))
    base = d.textlength(sub_txt, font=sub)
    gaps = len(sub_txt) - 1
    extra = max(0.0, (aw - base) / gaps) if gaps else 0.0
    x = text_x
    for ch in sub_txt:
        d.text((x, H * 0.72), ch, font=sub, fill=WHITE, anchor='lm')
        x += d.textlength(ch, font=sub) + extra

    return im.resize((w, h), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (w, h) in {
        'logo-aashi.png': (160, 32),
        'logo-aashi@2x.png': (320, 65),
        'logo-aashi@3x.png': (480, 98),
        'logo-aashi-hosted.png': (640, 130),
    }.items():
        img = render(w, h)
        img.save(OUT / name)
        print(f'  {name:24s} {w}x{h}')


if __name__ == '__main__':
    main()
