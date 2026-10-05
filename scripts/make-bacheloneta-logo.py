#!/usr/bin/env python3
"""Render the Bacheloneta wordmark for the app's supplier-credit slots.

    python3 scripts/make-bacheloneta-logo.py

Writes transparent PNGs to public/pass-assets/:
    logo-bacheloneta.png         160x32   wallet pass logo slot
    logo-bacheloneta@2x.png      320x65
    logo-bacheloneta@3x.png      480x98
    logo-bacheloneta-hosted.png  640x130  for partner_brands.logo_url

A copy of make-besolist-logo.py with the word changed, on purpose: these sit in
the same slots as BesoList, HypeList and Aashi and must read as siblings. Same
one ink, same Futura Bold, same capped tracking. "BACHELONETA" is eleven
glyphs, so width binds even earlier than BesoList's eight and the type comes
out a touch smaller; the cap means it never spreads into loose letters.

NOTE: THIS IS A PLACEHOLDER, not Bacheloneta's own artwork (their Instagram,
@bacheloneta, sits behind a login). Replace it with the original the moment
they send one — one upload on /portal/brands/<id>.
"""

import pathlib
from PIL import Image, ImageDraw, ImageFont

INK = (244, 244, 244, 255)      # sampled from logo-rumbalist@2x.png
WORD = 'BACHELONETA'
FONT = '/System/Library/Fonts/Supplemental/Futura.ttc'
FONT_INDEX = 2                  # Futura Bold — matches Rumba's solid weight
OUT = pathlib.Path('public/pass-assets')

PAD_X = 0.012
PAD_Y = 0.03
# Cap per-gap tracking at a fraction of the type size. Aashi's five glyphs fill
# 160px comfortably; eight glyphs would otherwise be spaced until the word
# reads as loose letters rather than a wordmark.
MAX_TRACK_EM = 0.18


def render(w, h):
    """Draw at 4x and downsample — keeps the geometric curves clean."""
    S = 4
    W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    avail_w = W * (1 - 2 * PAD_X)
    avail_h = H * (1 - 2 * PAD_Y)

    # Grow the type until it fills the height OR the glyphs alone fill the
    # width — with eight characters the width is usually the binding limit.
    size = 8
    while True:
        f = ImageFont.truetype(FONT, size, index=FONT_INDEX)
        box = d.textbbox((0, 0), WORD, font=f)
        glyphs_w = sum(d.textlength(c, font=f) for c in WORD)
        if (box[3] - box[1]) >= avail_h or glyphs_w >= avail_w or size > H * 2:
            break
        size += 2
    font = ImageFont.truetype(FONT, size, index=FONT_INDEX)

    widths = [d.textlength(c, font=font) for c in WORD]
    gaps = len(WORD) - 1
    track = max(0.0, (avail_w - sum(widths)) / gaps) if gaps else 0.0
    track = min(track, size * MAX_TRACK_EM)

    # Centre whatever the capped tracking did not consume.
    word_w = sum(widths) + track * gaps
    box = d.textbbox((0, 0), WORD, font=font)
    x = (W - word_w) / 2
    y = (H - (box[3] - box[1])) / 2 - box[1]
    for ch, cw in zip(WORD, widths):
        d.text((x, y), ch, font=font, fill=INK)
        x += cw + track

    return im.resize((w, h), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (w, h) in {
        'logo-bacheloneta.png': (160, 32),
        'logo-bacheloneta@2x.png': (320, 65),
        'logo-bacheloneta@3x.png': (480, 98),
        'logo-bacheloneta-hosted.png': (640, 130),
    }.items():
        render(w, h).save(OUT / name)
        print(f'  {name:29s} {w}x{h}')


if __name__ == '__main__':
    main()
