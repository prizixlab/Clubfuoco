#!/usr/bin/env python3
"""Render the BesoList wordmark for the app's supplier-credit slots.

    python3 scripts/make-besolist-logo.py

Writes transparent PNGs to public/pass-assets/:
    logo-besolist.png         160x32   wallet pass logo slot
    logo-besolist@2x.png      320x65
    logo-besolist@3x.png      480x98
    logo-besolist-hosted.png  640x130  for partner_brands.logo_url

Deliberately built to the same rules as make-aashi-logo.py, because these two
sit in the same slots and must read as siblings rather than as two unrelated
brands:

  * LETTERS ONLY, ONE INK (#F4F4F4, sampled from logo-rumbalist). These land on
    coloured surfaces — the "Join guest list" button, the offer row, a wallet
    pass — where a second colour competes with the button.
  * Futura Bold, letterspaced to fill the frame edge to edge, so whatever
    scales it gets a consistent optical weight.

DIFFERENCE FROM AASHI, and the reason this is not a copy-paste: "BESOLIST" is
eight characters against Aashi's five. Tracking the same way would set it far
looser per gap and leave a thin, stretched word; instead the type is grown to
the height first and tracking is CAPPED (MAX_TRACK_EM), with whatever is left
over balanced as equal side margins. The word stays centred and keeps Aashi's
weight rather than being pulled to the edges.

NOTE: THIS IS A PLACEHOLDER, not BesoList's own artwork. Their real mark sits
behind a Cloudflare challenge on their Fourvenues page and there is no public
route to it. Replace it with the original the moment they send one — one
upload on /portal/brands/<id>.
"""

import pathlib
from PIL import Image, ImageDraw, ImageFont

INK = (244, 244, 244, 255)      # sampled from logo-rumbalist@2x.png
WORD = 'BESOLIST'
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
        'logo-besolist.png': (160, 32),
        'logo-besolist@2x.png': (320, 65),
        'logo-besolist@3x.png': (480, 98),
        'logo-besolist-hosted.png': (640, 130),
    }.items():
        render(w, h).save(OUT / name)
        print(f'  {name:26s} {w}x{h}')


if __name__ == '__main__':
    main()
