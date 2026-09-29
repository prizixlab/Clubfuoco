#!/usr/bin/env python3
"""Render the HypeList wordmark for the app's supplier-credit slots.

    python3 scripts/make-hypelist-logo.py

Writes transparent PNGs to public/pass-assets/:
    logo-hypelist.png         160x32   wallet pass logo slot
    logo-hypelist@2x.png      320x65
    logo-hypelist@3x.png      480x98
    logo-hypelist-hosted.png  640x130  for partner_brands.logo_url

Built to the same rules as make-besolist-logo.py and make-aashi-logo.py,
because these sit in the same slots and must read as siblings rather than as
unrelated brands:

  * ONE INK (#F4F4F4, sampled from logo-rumbalist). These land on coloured
    surfaces — the "Join guest list" button, the offer row, a wallet pass —
    where a second colour competes with the button.
  * Futura Bold, tracked to fill the frame, with tracking CAPPED so eight
    glyphs do not read as loose letters.

DIFFERENCE FROM BESOLIST, and the reason this is not a copy-paste: HypeList
have real artwork and BesoList did not. Their bunny mark rides at the left of
the wordmark, reduced to the same single ink.

That reduction is the point, not a shortcut. The original is white line-art
inside a rainbow bloom — gorgeous on their black site, mud on a gold button at
32px tall. Pixels that are both opaque and near-white are kept as the mark;
the bloom is dropped. What survives is the line-art itself.

The untouched original is kept at
data/suppliers/hypelist/hypelist-mark-original.png, and is what should go into
partner_brands.logo_url if the credit slot ever renders on a dark surface at a
size where the bloom reads.

Source: https://www.hypelistbarcelona.com/ nav logo ("Logo hype summer png",
842x842 transparent PNG), fetched 17 Sep 2026.
"""

import pathlib
from PIL import Image, ImageDraw, ImageFont

INK = (244, 244, 244, 255)      # sampled from logo-rumbalist@2x.png
WORD = 'HYPELIST'
FONT = '/System/Library/Fonts/Supplemental/Futura.ttc'
FONT_INDEX = 2                  # Futura Bold — matches Rumba's solid weight
OUT = pathlib.Path('public/pass-assets')
MARK_SRC = pathlib.Path('data/suppliers/hypelist/hypelist-mark-original.png')

PAD_X = 0.012
PAD_Y = 0.03
MAX_TRACK_EM = 0.18

# How much of the frame width the bunny may take, and the breathing room
# between it and the H. Kept tight: the wordmark is the thing being read.
MARK_GAP = 0.06                 # of frame width


def flatten_mark(size_px):
    """Their bunny, reduced to one ink.

    Keeps pixels that are opaque AND near-white — the drawn line-art — and
    drops the rainbow bloom, whose partial alpha would otherwise flatten into
    a grey halo around the whole animal.
    """
    src = Image.open(MARK_SRC).convert('RGBA')
    px = src.load()
    out = Image.new('RGBA', src.size, (0, 0, 0, 0))
    op = out.load()
    for y in range(src.size[1]):
        for x in range(src.size[0]):
            r, g, b, a = px[x, y]
            if a > 200 and (r + g + b) / 3 > 200:
                op[x, y] = INK
    # Trim to the ink so the glyph sits on its own bounds, not the source's
    # generous padding — otherwise it lands visually small next to the type.
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    h = size_px
    w = max(1, round(out.size[0] * h / out.size[1]))
    return out.resize((w, h), Image.LANCZOS)


def render(w, h):
    """Draw at 4x and downsample — keeps the geometric curves clean."""
    S = 4
    W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    avail_h = H * (1 - 2 * PAD_Y)
    mark = flatten_mark(int(avail_h))
    gap = W * MARK_GAP
    avail_w = W * (1 - 2 * PAD_X) - mark.size[0] - gap

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

    word_w = sum(widths) + track * gaps
    box = d.textbbox((0, 0), WORD, font=font)

    total = mark.size[0] + gap + word_w
    x = (W - total) / 2
    im.alpha_composite(mark, (int(x), int((H - mark.size[1]) / 2)))
    x += mark.size[0] + gap

    y = (H - (box[3] - box[1])) / 2 - box[1]
    for ch, cw in zip(WORD, widths):
        d.text((x, y), ch, font=font, fill=INK)
        x += cw + track

    return im.resize((w, h), Image.LANCZOS)


def main():
    if not MARK_SRC.exists():
        raise SystemExit(f'! missing {MARK_SRC} — see the docstring for its source')
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (w, h) in {
        'logo-hypelist.png': (160, 32),
        'logo-hypelist@2x.png': (320, 65),
        'logo-hypelist@3x.png': (480, 98),
        'logo-hypelist-hosted.png': (640, 130),
    }.items():
        render(w, h).save(OUT / name)
        print(f'  {name:26s} {w}x{h}')


if __name__ == '__main__':
    main()
