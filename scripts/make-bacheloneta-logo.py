#!/usr/bin/env python3
"""Render the Bacheloneta logo — their globe mark plus wordmark — for the
app's supplier-credit slots.

    python3 scripts/make-bacheloneta-logo.py

Writes transparent PNGs to public/pass-assets/:
    logo-bacheloneta.png         160x32   wallet pass logo slot
    logo-bacheloneta@2x.png      320x65
    logo-bacheloneta@3x.png      480x98
    logo-bacheloneta-hosted.png  640x130  for partner_brands.logo_url

Built to the same rules as make-hypelist-logo.py, because these sit in the
same slots and must read as siblings:

  * ONE INK (#F4F4F4, sampled from logo-rumbalist). These land on coloured
    surfaces — the "Join guest list" button, the offer row, a wallet pass —
    where a second colour competes with the button. Their red lives in
    partner_brands.color instead.
  * Futura Bold for the word, tracking capped so eleven glyphs don't read as
    loose letters.
  * Their mark rides at the left of the wordmark, like HypeList's bunny.

THE MARK IS REDRAWN, NOT TRACED. Their only public artwork is the Instagram
avatar (@bacheloneta), 150x150 — kept at
data/suppliers/bacheloneta/instagram-avatar-original.jpg. Upscaling that
would be mush, so the globe is rebuilt as geometry: a wireframe sphere of
great circles at assorted tilts, projected orthographically, which is what
their mark is. Their arched wordmark over the globe is NOT reproduced — at
32px tall an arc of eleven letters is unreadable; the straight word beside
the globe carries the name instead.

Replace with their own vector artwork the moment they send it — one upload
on /portal/brands/<id>.
"""

import math
import pathlib
from PIL import Image, ImageDraw, ImageFont

INK = (244, 244, 244, 255)      # sampled from logo-rumbalist@2x.png
WORD = 'BACHELONETA'
FONT = '/System/Library/Fonts/Supplemental/Futura.ttc'
FONT_INDEX = 2                  # Futura Bold
OUT = pathlib.Path('public/pass-assets')

PAD_X = 0.012
PAD_Y = 0.03
MAX_TRACK_EM = 0.14
GAP_EM = 0.30                   # space between globe and word, in type sizes

# Great-circle normals as (tilt from the pole, azimuth) in degrees. Chosen to
# look like their mark — a loose tangle, no clean lat/long grid — while
# keeping every ring a distinct ellipse (no two near-parallel) so it still
# reads at 32px.
RINGS = [(0, 0), (90, 0), (90, 60), (90, 120), (62, 25), (62, 145), (62, 265), (35, 200)]
VIEW_TILT = math.radians(18)    # tip the sphere toward the viewer a little


def ring_points(tilt, az, r, cx, cy, steps=180):
    """Points of one great circle, rotated, projected onto the image plane."""
    t, a = math.radians(tilt), math.radians(az)
    n = (math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), math.cos(t))
    # Any vector not parallel to n, then two orthonormal vectors in its plane.
    k = (1, 0, 0) if abs(n[0]) < 0.9 else (0, 1, 0)
    u = (n[1] * k[2] - n[2] * k[1], n[2] * k[0] - n[0] * k[2], n[0] * k[1] - n[1] * k[0])
    lu = math.sqrt(sum(c * c for c in u)); u = tuple(c / lu for c in u)
    v = (n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0])
    pts = []
    for i in range(steps + 1):
        s = 2 * math.pi * i / steps
        x, y, z = (math.cos(s) * u[j] + math.sin(s) * v[j] for j in range(3))
        # Tilt about the x axis, then drop z (orthographic).
        y, z = y * math.cos(VIEW_TILT) - z * math.sin(VIEW_TILT), y * math.sin(VIEW_TILT) + z * math.cos(VIEW_TILT)
        pts.append((cx + x * r, cy - y * r))
    return pts


def draw_globe(d, cx, cy, r, line):
    for tilt, az in RINGS:
        d.line(ring_points(tilt, az, r, cx, cy), fill=INK, width=line, joint='curve')
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=INK, width=round(line * 1.6))


def render(w, h):
    """Draw at 4x and downsample — keeps the curves clean."""
    S = 4
    W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    avail_w = W * (1 - 2 * PAD_X)
    avail_h = H * (1 - 2 * PAD_Y)
    r = avail_h / 2
    # Lines scale with the frame, but never thinner than ~1px at 1x, or the
    # wallet-pass size loses the rings entirely.
    line = max(S, round(H * 0.022))

    # Size the word against the width left after the globe and a gap; type
    # height is capped at ~62% of the globe so the mark leads.
    size = 8
    while True:
        f = ImageFont.truetype(FONT, size, index=FONT_INDEX)
        box = d.textbbox((0, 0), WORD, font=f)
        glyphs_w = sum(d.textlength(c, font=f) for c in WORD)
        room = avail_w - 2 * r - size * GAP_EM
        if (box[3] - box[1]) >= avail_h * 0.62 or glyphs_w >= room or size > H * 2:
            break
        size += 2
    font = ImageFont.truetype(FONT, size, index=FONT_INDEX)
    widths = [d.textlength(c, font=font) for c in WORD]
    gaps = len(WORD) - 1
    room = avail_w - 2 * r - size * GAP_EM
    track = min(max(0.0, (room - sum(widths)) / gaps), size * MAX_TRACK_EM)
    word_w = sum(widths) + track * gaps

    # Centre the whole lockup (globe + gap + word) in the frame.
    total = 2 * r + size * GAP_EM + word_w
    x0 = (W - total) / 2
    draw_globe(d, x0 + r, H / 2, r - line, line)

    box = d.textbbox((0, 0), WORD, font=font)
    x = x0 + 2 * r + size * GAP_EM
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
