#!/usr/bin/env python3
"""Render the Aashi wordmark for the app's supplier-credit slots.

    python3 scripts/make-aashi-logo.py

Writes transparent PNGs to public/pass-assets/:
    logo-aashi.png         160x32   wallet pass logo slot
    logo-aashi@2x.png      320x65
    logo-aashi@3x.png      480x98
    logo-aashi-hosted.png  640x130  for partner_brands.logo_url

Built to sit beside logo-rumbalist, which it is measured against:

  * LETTERS ONLY. The supplier's own mark pairs twin hearts with the wordmark,
    but this lands on top of coloured surfaces — the "Join guest list" button,
    the offer row, a wallet pass — where a second colour competes with the
    button and a small icon turns to mush. Rumba solves it the same way.
  * ONE INK, #F4F4F4, sampled from logo-rumbalist so the two suppliers read as
    siblings rather than as two unrelated brands.
  * Futura: geometric and slightly wide, so it holds its own next to Rumba's
    display face without being loud. Neutral enough not to fight the venue
    photography behind it.
  * Letterspaced to FILL the frame edge to edge, like Rumba's, so whatever
    scales it gets a consistent optical weight instead of a small word adrift
    in a wide box.

NOTE: a rendition for in-app use, not Aashi's master artwork. Ask them for the
original before it goes to print.
"""

import pathlib
from PIL import Image, ImageDraw, ImageFont

INK = (244, 244, 244, 255)      # sampled from logo-rumbalist@2x.png
WORD = 'AASHI'
FONT = '/System/Library/Fonts/Supplemental/Futura.ttc'
FONT_INDEX = 2                  # Futura Bold — upright, matching Rumba's solid weight
OUT = pathlib.Path('public/pass-assets')

# Fraction of the canvas left as breathing room, matched to Rumba's (its
# glyphs run x 4-315 of 320, y 2-61 of 65).
PAD_X = 0.012
PAD_Y = 0.03


def render(w, h):
    """Draw at 4x and downsample — keeps the geometric curves clean."""
    S = 4
    W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    avail_w = W * (1 - 2 * PAD_X)
    avail_h = H * (1 - 2 * PAD_Y)

    # Grow the type until it fills the height, then letterspace to the width.
    size = 8
    while True:
        f = ImageFont.truetype(FONT, size, index=FONT_INDEX)
        box = d.textbbox((0, 0), WORD, font=f)
        if box[3] - box[1] >= avail_h or size > H * 2:
            break
        size += 2
    font = ImageFont.truetype(FONT, size, index=FONT_INDEX)

    widths = [d.textlength(c, font=font) for c in WORD]
    gaps = len(WORD) - 1
    track = max(0.0, (avail_w - sum(widths)) / gaps) if gaps else 0.0

    box = d.textbbox((0, 0), WORD, font=font)
    x = W * PAD_X
    y = (H - (box[3] - box[1])) / 2 - box[1]
    for ch, cw in zip(WORD, widths):
        d.text((x, y), ch, font=font, fill=INK)
        x += cw + track

    return im.resize((w, h), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (w, h) in {
        'logo-aashi.png': (160, 32),
        'logo-aashi@2x.png': (320, 65),
        'logo-aashi@3x.png': (480, 98),
        'logo-aashi-hosted.png': (640, 130),
    }.items():
        render(w, h).save(OUT / name)
        print(f'  {name:24s} {w}x{h}')


if __name__ == '__main__':
    main()
