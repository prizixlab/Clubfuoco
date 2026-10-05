#!/usr/bin/env python3
"""Turn the reader's raw Fourvenues snapshot into the offers the app sells.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/fourvenues_map.py. Redeploy:

    scp scripts/agentbox/fourvenues_map.py agentbox:~/scraper/fourvenues_map.py

Reads the newest run in intel/fourvenues/fourvenues.sqlite (written by
fourvenues_reader.py) and writes intel/fourvenues/offers.json.

── The one rule: sort by what the guest PAYS, never by what Fourvenues calls it
Fourvenues files products in three lists — ticket types, guestlist types and
table zones — and promoters put free entry in whichever one they like. "GUEST
LIST - FREE TILL 1H" arrives as a €0 TICKET; "LISTA 01:00-01:30" arrives as a
€10 GUESTLIST that is paid at the door. The list tells us which checkout URL to
build and nothing else. What the guest sees comes from `settle`:

    free    nothing to pay, anywhere           → shown as Guestlist
    door    signs up now, pays at the venue    → shown with the door price, loudly
    online  pays now, through Fourvenues        → shown as Ticket (Apple Pay)
    table   a table zone; rates carry the price → shown as Table

Guestlist-type prices are settled at the door: their own page says "The price
will be paid at the venue upon arrival", and their tracking code records list
items at €0 because "a payment from the list will not be managed in the
application". `door_verified` is False until a page check confirms it per list.

Usage:
    ~/scraper/venv/bin/python3 ~/scraper/fourvenues_map.py [--run N] [--out PATH]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DIR = ROOT / "intel" / "fourvenues"
SQLITE = DIR / "fourvenues.sqlite"
MADRID = ZoneInfo("Europe/Madrid")
WEB = "https://web.fourvenues.com/en/iframe"

# Fourvenues venue name → clubs.id. Verified by name against `clubs` on 17 Sep
# 2026 for the HypeList import (scripts/import-hypelist-events.mjs, VENUE) —
# keep the two in step. A venue not listed here still gets its offers, with
# club_id null, and simply doesn't appear on a club page.
CLUBS = {
    "opium barcelona": "b3f7747f-d911-490d-a688-d04add6a1c8b",
    "ku barcelona": "d184f2f1-8db3-4d03-ae11-ad19b650894d",
    "bling bling bcn": "07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2",
    "sutton barcelona": "e0cf6310-28e5-4117-ad5f-01179f87d8fd",
    "downtown barcelona": "60d6f94e-26cc-4d24-bacc-8a255e1c7924",
    "bastian beach": "2706f18a-76ce-4276-abc0-ba53b7d6894d",
    "otto zutz": "b9bc5258-4349-4f05-af59-6556d961524a",
    "el tardet barcelona": "4ad56773-ffc0-4122-9dff-58bb77fb934d",
    "twenties barcelona": "3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb",
    "boris": "277cd0b1-c8c5-4769-bf28-07d03f96d145",
    "la biblio bcn": "1a49859c-ebcf-417a-b025-3dd84bcb1d54",
    "hype barcelona": "00e3f149-bd90-4180-83f9-a79ebf71ab8f",
    "nix barcelona": "91ef759c-4b34-4e63-ab2a-ac015dcf76e8",
    "la fira casanova": "f710a3a3-c84e-408a-a061-d6791215848a",
    "duvet": "cd260c75-6a5e-464e-a24d-48155b6d0c5a",          # Duvet Barcelona
    "nu bcn": "cecc969c-ded2-40d3-9dfb-54e606e67f26",         # added 1 Oct 2026 (Google Places)
    "la fira villarroel": "5eaaf6ad-c479-4e7e-b735-f3459b319aac",
    "la fira provença": "fb8a09e0-6a79-4023-b990-6a0702d88053",
    "costa breve": "dbf8342b-e7b8-4f27-97d2-5982bc4a3947",
}

# A night out that starts before 06:00 belongs to the previous evening — the
# same shift import-hypelist-events.mjs applies.
NIGHT_ROLLOVER_HOUR = 6


def night_of(epoch: int) -> str:
    t = dt.datetime.fromtimestamp(epoch, MADRID)
    if t.hour < NIGHT_ROLLOVER_HOUR:
        t -= dt.timedelta(days=1)
    return t.date().isoformat()


def hhmm(epoch: int | None) -> str | None:
    return dt.datetime.fromtimestamp(epoch, MADRID).strftime("%H:%M") if epoch else None


def iso(epoch: int | None) -> str | None:
    return dt.datetime.fromtimestamp(epoch, MADRID).isoformat() if epoch else None


def clean(s: str | None) -> str | None:
    s = (s or "").strip()
    return s or None


def latest(con: sqlite3.Connection, run: int, code: str, endpoint: str):
    row = con.execute(
        "select body from raw where run_id=? and code=? and endpoint=? and status=200"
        " order by rowid desc limit 1", (run, code, endpoint)).fetchone()
    if not row or not row[0]:
        return None
    try:
        return json.loads(row[0]).get("data")
    except json.JSONDecodeError:
        return None


def first_time(s: str | None) -> str | None:
    """'Hasta la(s) 01:30' / 'Until 1:30' → '01:30'; no time → None."""
    m = re.search(r"(\d{1,2}):(\d{2})", s or "")
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def strip_label(s: str | None) -> str | None:
    """Drop Fourvenues' own 'Includes:' / 'Incluye:' lead-in."""
    if not s:
        return s
    return re.sub(r"^\s*(?:includes|incluye|inclou|include|comprend)\s*:\s*", "", s, flags=re.I) or None


def tickets(data: list, base: str) -> list[dict]:
    out = []
    for t in data or []:
        price = float(t.get("price") or 0)
        opt = (t.get("options") or [{}])[0]
        cust = t.get("customers") or {}
        out.append({
            "id": t["id"],
            "source": "ticket",
            "name": clean(t.get("name")),
            "detail": clean(opt.get("content")),
            "price": price,
            "settle": "online" if price > 0 else "free",
            "min": cust.get("min") or 1,
            "max": cust.get("max") or 10,
            "sold_out": bool(t.get("isSoldOut") or opt.get("isSoldOut")),
            "few_left": bool(t.get("areFewLeft")),
            "sale_ends": iso((t.get("dates") or {}).get("to")),
            # {qty} is filled in by the app.
            "checkout": f"{base}/tickets/{t['id']}/{{qty}}/form",
        })
    return out


def guestlists(data: list, base: str) -> list[dict]:
    out = []
    for g in data or []:
        opts = g.get("options") or [{}]
        price = float(min((o.get("price") or 0) for o in opts))
        # The entry window. Fourvenues sends it as text in whatever language
        # the page loaded in ("From 01:00" / "A partir de la(s) 01:00",
        # "Until 01:30" / "Hasta la(s) 01:30") — keep only the times, and let
        # the app say it in the guest's language.
        summary = (g.get("summary") or [{}])[0] or {}
        window = {"from": first_time(summary.get("duration")), "until": first_time(summary.get("until"))}
        includes = next((clean(o.get("content")) for o in opts if clean(o.get("content"))), None) \
            or strip_label(clean(summary.get("content")))
        out.append({
            "id": g["id"],
            "source": "guestlist",
            "name": clean(g.get("name")),
            "detail": includes,
            "window": window if window["from"] or window["until"] else None,
            "price": price,
            "settle": "door" if price > 0 else "free",
            "door_verified": False,
            "min": 1,
            "max": g.get("maximum") or 5,
            "sold_out": bool(g.get("isComplete")) or g.get("available") == 0,
            "few_left": False,
            "min_age": max((o.get("age") or 0) for o in opts) or None,
            "sale_ends": iso((g.get("dates") or {}).get("to")),
            "checkout": f"{base}/guest-list/{g['id']}/{{qty}}/form",
        })
    return out


# Per-rate capacities from fourvenues_zones.py (zone_rates). Filled in main().
RATE_META: dict[tuple[str, str], dict] = {}
# Floor plans from fourvenues_zones.py (zone_maps), keyed (event code, zone id).
ZONE_MAPS: dict[tuple[str, str], dict] = {}

# ── Plan images ───────────────────────────────────────────────────────────────
# Copied once into our public Storage (fourvenues/maps/<sha1>.<ext>): older
# plans live on disk.fourvenues.com, which refuses requests without a browser
# User-Agent, so the app can't rely on loading them from there. The same
# download gives a 16×16 fingerprint, used to tell a venue that publishes one
# whole-venue plan per area (Bastian: same picture, different highlight) from
# one that publishes close-up crops (Opium, Ku).
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Mobile/15E148")
SAME_PLAN = 0.12        # fingerprint distance below which two images are one plan


def _sb_env() -> tuple[str, str] | None:
    try:
        from fourvenues_push import supabase_env
        return supabase_env()
    except Exception:  # noqa: BLE001 — no creds: keep Fourvenues' URLs
        return None


def plan_images(con: sqlite3.Connection, urls: set[str]) -> dict[str, tuple[str, str | None]]:
    """url → (url to serve, fingerprint). Mirrors and fingerprints new ones."""
    import hashlib, io, urllib.request
    con.execute("create table if not exists map_images (url text primary key, public_url text,"
                " ahash text, fetched_at text)")
    known = {u: (pu, h) for u, pu, h in con.execute("select url, public_url, ahash from map_images")}
    env = None
    for url in sorted(urls - set(known)):
        public, ahash = url, None
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read()
            try:
                from PIL import Image
                im = Image.open(io.BytesIO(raw)).convert("L").resize((16, 16))
                px = list(im.getdata()); avg = sum(px) / len(px)
                ahash = "".join("1" if p > avg else "0" for p in px)
            except Exception:  # noqa: BLE001
                pass
            env = env or _sb_env()
            if env:
                ext = (url.rsplit(".", 1)[-1].lower() if "." in url[-6:] else "png").split("?")[0]
                key = f"maps/{hashlib.sha1(url.encode()).hexdigest()}.{ext}"
                ctype = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}.get(ext, "image/png")
                req = urllib.request.Request(f"{env[0]}/storage/v1/object/fourvenues/{key}", data=raw, method="POST",
                                             headers={"apikey": env[1], "Authorization": f"Bearer {env[1]}",
                                                      "Content-Type": ctype, "x-upsert": "true",
                                                      "Cache-Control": "max-age=604800"})
                urllib.request.urlopen(req, timeout=60).read()
                public = f"{env[0]}/storage/v1/object/public/fourvenues/{key}"
        except Exception as ex:  # noqa: BLE001 — one bad image never sinks the feed
            print(f"  plan image skipped ({ex}): {url[-70:]}")
            continue
        con.execute("insert or replace into map_images values (?,?,?,datetime('now'))", (url, public, ahash))
        known[url] = (public, ahash)
    con.commit()
    return known


IMG_CACHE = ROOT / "intel" / "fourvenues" / "maps"


def _image(url: str):
    """The plan image (PIL, RGB), cached on disk after one download."""
    import hashlib, io, urllib.request
    from PIL import Image
    IMG_CACHE.mkdir(parents=True, exist_ok=True)
    f = IMG_CACHE / hashlib.sha1(url.encode()).hexdigest()
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read())
    return Image.open(f).convert("RGB")


def tables_painted(url: str, spaces: list[dict]) -> bool:
    """Does the picture already show the tables? Sample it at each table's
    centre (placed the way the app draws it: fitted into the square,
    left-aligned, vertically centred) and compare with the table's price
    colour. Painted plans get tap targets only; bare plans (Ku's outlines)
    get the coloured shapes drawn."""
    try:
        im = _image(url)
    except Exception:  # noqa: BLE001
        return False
    W, H = im.size
    k = min(1 / W, 1 / H)                       # image units → square fraction
    dw, dh = W * k, H * k
    oy = (1 - dh) / 2
    hits = n = 0
    for sp in spaces:
        rgb = sp.get("rgb")
        if not rgb or len(rgb) < 3:
            continue
        cx = (sp["left"] + sp["w"] / 2) / 100
        cy = (sp["top"] + sp["w"] / 2) / 100
        if not (0 <= cx <= dw and oy <= cy <= oy + dh):
            continue
        at = lambda x, y: im.getpixel((min(W - 1, max(0, int(x / k))), min(H - 1, max(0, int((y - oy) / k)))))
        dist = lambda a, b: sum((p - q) ** 2 for p, q in zip(a, b)) ** 0.5
        px = at(cx, cy)
        # Just outside the table's box, all four sides: the floor around it.
        r = sp["w"] * (sp.get("s") or 1) / 100 * 0.95
        ring = [at(cx + dx, cy + dy) for dx, dy in ((r, 0), (-r, 0), (0, r), (0, -r))]
        floor = tuple(sum(c[i] for c in ring) / 4 for i in range(3))
        n += 1
        # Painted: the table's own price colour is there, or something clearly
        # different from the floor around it (numbered circles, drawn beds).
        if dist(px, rgb[:3]) < 80 or dist(px, floor) > 70:
            hits += 1
    return n > 0 and hits / n >= 0.5


def align_positions(url: str, spaces: list[dict]) -> float:
    """Fix a map whose table positions were entered on an older or
    differently-framed picture (Ku's Belvedere: every table ~25% off the same
    way). Score = share of tables whose centre lands on their price colour.
    If the positions as given score < 70%, search one shift (and scale) for
    the whole map, apply the best one when it does clearly better, and return
    the final score — the caller marks the map approximate if it stays low."""
    try:
        im = _image(url)
    except Exception:  # noqa: BLE001
        return 0.0
    W, H = im.size
    f = 300 / max(W, H)
    if f < 1:
        im = im.resize((max(1, int(W * f)), max(1, int(H * f))))
    W, H = im.size
    px = im.load()
    side = max(W, H)
    oy = (side - H) / 2
    tables = [(sp["left"] + sp["w"] / 2, sp["top"] + sp["w"] / 2, tuple(sp["rgb"][:3]))
              for sp in spaces if sp.get("rgb") and len(sp["rgb"]) >= 3]
    if not tables:
        return 0.0

    def score(dx: float, dy: float, k: float) -> float:
        hit = 0
        for cx, cy, rgb in tables:
            x = ((cx - 50) * k + 50 + dx) / 100 * side
            y = ((cy - 50) * k + 50 + dy) / 100 * side - oy
            if 0 <= x < W and 0 <= y < H:
                c = px[int(x), int(y)]
                if ((c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2) ** 0.5 < 70:
                    hit += 1
        return hit / len(tables)

    base = score(0, 0, 1)
    if base >= 0.7:
        return base
    best = (base, 0.0, 0.0, 1.0)
    for k in (0.8, 0.9, 1.0, 1.1, 1.25):
        for dx in range(-36, 37, 2):
            for dy in range(-36, 37, 2):
                sc = score(dx, dy, k)
                if sc > best[0]:
                    best = (sc, dx, dy, k)
    sc, dx, dy, k = best
    for ddx in (-1, 0, 1):                       # refine to 1%
        for ddy in (-1, 0, 1):
            s2 = score(dx + ddx, dy + ddy, k)
            if s2 > sc:
                sc, best = s2, (s2, dx + ddx, dy + ddy, k)
    sc, dx, dy, k = best
    # Only move the tables when the shift explains clearly more of them.
    if sc >= 0.7 and sc >= base + 0.3:
        for sp in spaces:
            cx, cy = sp["left"] + sp["w"] / 2, sp["top"] + sp["w"] / 2
            w = sp["w"] * k
            ncx, ncy = (cx - 50) * k + 50 + dx, (cy - 50) * k + 50 + dy
            sp["left"], sp["top"], sp["w"] = round(ncx - w / 2, 2), round(ncy - w / 2, 2), round(w, 2)
        return sc
    return base


def colours_drawn(url: str, spaces: list[dict]) -> float:
    """Share of the map's distinct price colours that appear anywhere in the
    picture (≥ 25 close pixels) — i.e. the plan draws its tables, whether or
    not the venue's points land on them."""
    try:
        im = _image(url)
    except Exception:  # noqa: BLE001
        return 0.0
    W, H = im.size
    f = 200 / max(W, H)
    if f < 1:
        im = im.resize((max(1, int(W * f)), max(1, int(H * f))))
    pixels = list(im.getdata())
    colours = {tuple(sp["rgb"][:3]) for sp in spaces if sp.get("rgb") and len(sp["rgb"]) >= 3}
    if not colours:
        return 0.0
    found = 0
    for rgb in colours:
        n = 0
        for c in pixels:
            if abs(c[0] - rgb[0]) + abs(c[1] - rgb[1]) + abs(c[2] - rgb[2]) < 60:
                n += 1
                if n >= 25:
                    found += 1
                    break
    return found / len(colours)


def snap_tables(url: str, spaces: list[dict]) -> None:
    """Find each table's real outline in the picture → space["box"] =
    [x, y, w, h] (percent of the square). Venue-entered positions are
    approximate, so the app rings the drawn shape instead.

    One rule set for every venue — no per-club tuning:
      1. seed at the table's price colour nearest the venue's point (else the
         pixel under it);
      2. grow the same-colour region inside a window around the point;
      3. shave thin connectors (a circle joined to its label by a line, Ku's
         suite) by eroding, keep the piece at the seed, grow it back;
      4. accept only a compact shape (fills ≥45% of its box), of plausible
         size, sitting at the venue's point, with no other table inside;
         room-sized shapes (Opium's Black Room) need the exact price colour.
    Anything failing gets no box — the app then marks the venue's point
    instead of drawing a wrong outline."""
    try:
        im = _image(url)
    except Exception:  # noqa: BLE001
        return
    W, H = im.size
    f = 600 / max(W, H)                         # work on a ≤600 px copy
    if f < 1:
        im = im.resize((max(1, int(W * f)), max(1, int(H * f))))
    W, H = im.size
    px = im.load()
    side = max(W, H)                            # the square, in these pixels
    oy = (side - H) / 2                         # left-aligned, vertically centred
    dist = lambda a, b: sum((p - q) ** 2 for p, q in zip(a, b)) ** 0.5
    points = [((o["left"] + o["w"] / 2) / 100 * side, (o["top"] + o["w"] / 2) / 100 * side - oy) for o in spaces]

    def region(seed, ref, lim, cx, cy):
        """Same-colour pixels connected to the seed inside ±lim; None if the
        region leaks out of the window (it's the floor)."""
        x0w, x1w = max(0, int(cx) - lim), min(W - 1, int(cx) + lim)
        y0w, y1w = max(0, int(cy) - lim), min(H - 1, int(cy) + lim)
        seen = {seed}
        stack = [seed]
        while stack:
            if len(seen) > 200000:
                return None
            x, y = stack.pop()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if (nx, ny) in seen:
                    continue
                if not (x0w <= nx <= x1w and y0w <= ny <= y1w):
                    return None
                if dist(px[nx, ny], ref) < 45:
                    seen.add((nx, ny))
                    stack.append((nx, ny))
        return seen

    def shave(mask, seed, r):
        """Erode by r (drop pixels within r of the edge), keep the piece
        nearest the seed, grow it back by r inside the mask."""
        if r < 1:
            return mask
        depth = {}
        frontier = [p for p in mask if any(n not in mask for n in
                    ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)))]
        for p in frontier:
            depth[p] = 1
        d = 1
        while frontier and d <= r:
            nxt = []
            for x, y in frontier:
                for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if n in mask and n not in depth:
                        depth[n] = d + 1
                        nxt.append(n)
            frontier, d = nxt, d + 1
        core = {p for p in mask if depth.get(p, r + 2) > r}
        if not core:
            return mask
        start = min(core, key=lambda p: (p[0] - seed[0]) ** 2 + (p[1] - seed[1]) ** 2)
        piece, stack = {start}, [start]
        while stack:
            x, y = stack.pop()
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in core and n not in piece:
                    piece.add(n)
                    stack.append(n)
        grown, frontier = set(piece), list(piece)
        for _ in range(r):
            nxt = []
            for x, y in frontier:
                for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if n in mask and n not in grown:
                        grown.add(n)
                        nxt.append(n)
            frontier = nxt
        return grown

    for idx, sp in enumerate(spaces):
        size = side * sp["w"] * (sp.get("s") or 1) / 100
        cx, cy = points[idx]
        rgb = tuple((sp.get("rgb") or [])[:3]) or None
        # 1. seed
        rad = int(size * 0.8) + 2
        seed, best = None, 1e9
        if rgb:
            for dy in range(-rad, rad + 1, 2):
                for dx in range(-rad, rad + 1, 2):
                    x, y = int(cx + dx), int(cy + dy)
                    if 0 <= x < W and 0 <= y < H and dist(px[x, y], rgb) < 70 and dx * dx + dy * dy < best:
                        best, seed = dx * dx + dy * dy, (x, y)
        matched = seed is not None
        if seed is None:
            seed = (int(cx), int(cy))
            if not (0 <= seed[0] < W and 0 <= seed[1] < H):
                continue
        ref = px[seed]
        exact = matched and rgb is not None and dist(ref, rgb) < 60
        # 2–3. region, connectors shaved
        box = None
        for mult, room in ((2.5, False), (7, True)):
            if room and not exact:
                break
            mask = region(seed, ref, int(size * mult) + 4, cx, cy)
            if not mask:
                continue
            mask = shave(mask, seed, max(2, int(size * 0.12)))
            xs = [p[0] for p in mask]
            ys = [p[1] for p in mask]
            bx0, by0 = min(xs), min(ys)
            bw, bh = max(xs) - bx0 + 1, max(ys) - by0 + 1
            # 4. checks
            if len(mask) / (bw * bh) < 0.45:                      # not compact
                continue
            if bw < size * 0.35 or bh < size * 0.35:              # a speck
                continue
            limit = 4 if room else (2.2 if matched else 1.6)
            if bw > size * limit or bh > size * limit:            # zone / bar / booth
                continue
            m = size * 0.6
            if not (bx0 - m <= cx <= bx0 + bw + m and by0 - m <= cy <= by0 + bh + m):
                continue                                         # not where the venue put it
            if any(bx0 <= ox <= bx0 + bw and by0 <= oy_ <= by0 + bh
                   for k, (ox, oy_) in enumerate(points) if k != idx):
                continue                                         # swallowed another table
            box = (bx0, by0, bw, bh)
            break
        if box:
            bx0, by0, bw, bh = box
            sp["box"] = [round(bx0 / side * 100, 2), round((by0 + oy) / side * 100, 2),
                         round(bw / side * 100, 2), round(bh / side * 100, 2)]


# ── New venues link themselves ──────────────────────────────────────────────
STOP = {"barcelona", "bcn", "club", "the", "discoteca", "disco", "sala", "bar", "de", "la", "el",
        "restaurant", "and", "y", "beach", "rooftop", "terrace", "nightclub"}


def _words(name: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if w not in STOP and len(w) > 1}


def auto_link(con: sqlite3.Connection, venue: str, lat, lng) -> str | None:
    """A Fourvenues venue not in CLUBS: the `clubs` row within ~200 m whose
    name shares a word with it — only when exactly one does. Remembered in
    venue_links (including "no match"), so each venue is looked up once;
    ambiguous or unmatched venues are logged for a human, never guessed."""
    con.execute("create table if not exists venue_links (venue text primary key, club_id text,"
                " how text, at text)")
    row = con.execute("select club_id from venue_links where venue=?", (venue,)).fetchone()
    if row:
        return row[0]
    if lat is None or lng is None:
        return None
    env = _sb_env()
    if not env:
        return None
    import urllib.request, urllib.parse
    d = 0.0025                                   # ≈ 200–280 m
    q = (f"clubs?select=id,name,lat,lng&lat=gte.{lat - d}&lat=lte.{lat + d}"
         f"&lng=gte.{lng - d}&lng=lte.{lng + d}&limit=50")
    try:
        req = urllib.request.Request(f"{env[0]}/rest/v1/{q}", headers={"apikey": env[1], "Authorization": f"Bearer {env[1]}"})
        rows = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception as ex:  # noqa: BLE001
        print(f"  auto-link {venue}: lookup failed ({ex})")
        return None
    want = _words(venue)
    hits = [r for r in rows if want & _words(r["name"])]
    club = hits[0]["id"] if len(hits) == 1 else None
    how = "auto" if club else ("ambiguous: " + ", ".join(r["name"] for r in hits[:4]) if hits else "no match nearby")
    con.execute("insert or replace into venue_links values (?,?,?,datetime('now'))", (venue, club, how))
    con.commit()
    print(f"  auto-link {venue!r} → {hits[0]['name'] if club else how}")
    return club


def vip_layout(zone_products: list[dict], images: dict[str, tuple[str, str | None]]) -> dict | None:
    """How the night's VIP areas fit together, for the app's overview map:
    "shared" — one plan for the whole venue (the same image, or one image per
    area that is the same plan with a different highlight): overview = that
    plan with every area's tables; "areas" — close-up crops with no common
    frame: overview = the areas as tiles."""
    imgs = [p["map"]["image"] for p in zone_products if p.get("map") and p["map"].get("image")]
    if not imgs:
        return None
    hashes = [images.get(u, (u, None))[1] for u in dict.fromkeys(imgs)]
    if len(hashes) == 1:
        same = True
    elif all(hashes):
        a = hashes[0]
        same = all(sum(x != y for x, y in zip(a, h)) / len(a) <= SAME_PLAN for h in hashes[1:])
    else:
        same = False
    return {"layout": "shared" if same else "areas", "overview": imgs[0] if same else None}


def zones(data: list, base: str, code: str = "") -> list[dict]:
    out = []
    for z in data or []:
        rates = []
        for r in z.get("types") or []:
            rate = {"id": r["id"], "name": clean(r.get("name")), "price": float(r.get("price") or 0)}
            # Allowed group sizes, exactly as Fourvenues offers them — not always
            # a range ("Lounge": 1–12, then 15–18; "Pool Bed": 4, 5 or 6).
            meta = RATE_META.get((z["id"], r["id"]))
            if meta:
                rate.update(meta)
            rates.append(rate)
        out.append({
            "id": z["id"],
            "source": "zone",
            "name": clean(z.get("name")),
            "detail": None,
            "price": min((r["price"] for r in rates), default=0.0),
            "settle": "table",
            "rates": rates,
            "sold_out": bool(z.get("isComplete")),
            "sale_starts": iso(z.get("saleStartingDate")),
            # Group size and deposit load on the zone page, not here; {pax} and
            # {rate} are filled by the app from the rate the guest picks.
            "checkout": f"{base}/bookings/{z['id']}/2?pax={{pax}}&rate={{rate}}",
            "zone_page": f"{base}/bookings/{z['id']}",
            # Where the zone's tables are: background + tables as percentages
            # of a square plan. The app draws it; none for zones without one.
            "map": ZONE_MAPS.get((code, z["id"])),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=int)
    ap.add_argument("--out", type=Path, default=DIR / "offers.json")
    args = ap.parse_args()

    con = sqlite3.connect(SQLITE)
    # An explicit --run may still be in progress; the default is the newest
    # run that finished and read something.
    if args.run:
        run, channel = con.execute("select id, channel from runs where id=?", (args.run,)).fetchone()
    else:
        run, channel = con.execute(
            "select id, channel from runs where finished_at is not null and events_read > 0"
            " order by id desc limit 1").fetchone()
    codes = [c for (c,) in con.execute(
        "select distinct code from raw where run_id=? and code is not null", (run,))]

    # Table capacities, when fourvenues_zones.py has been run (it may not have
    # yet — rates then simply carry no "pax", and the app falls back).
    try:
        for zid, rid, pax, mx, dep, dtype, full, desc in con.execute(
                "select zone_id, rate_id, pax, max_pax, deposit, deposit_type, full_payment, description"
                " from zone_rates"):
            sizes = json.loads(pax) if pax else []
            RATE_META[(zid, rid)] = {k: v for k, v in {
                "pax": sizes or None,
                "deposit": dep, "deposit_type": dtype,
                "full_payment": None if full is None else bool(full),
                "description": desc,
            }.items() if v is not None}
    except sqlite3.OperationalError:
        pass
    try:
        for code_, zid, image, spaces in con.execute(
                "select code, zone_id, image, spaces from zone_maps"):
            # Only tables placed on the plan (older rows may hold unplaced ones).
            sp = [x for x in (json.loads(spaces) if spaces else [])
                  if all(isinstance(x.get(k), (int, float)) for k in ("top", "left", "w"))]
            if image or sp:
                ZONE_MAPS[(code_, zid)] = {"image": image, "spaces": sp}
    except sqlite3.OperationalError:
        pass

    events = []
    for code in codes:
        ev = latest(con, run, code, "event")
        if not ev or not ev.get("visible", True):
            continue
        dates = ev.get("dates") or {}
        if dates.get("canceled") or not dates.get("start"):
            continue
        base = f"{WEB}/{channel}/events/{ev['slug']}-{code}"
        loc = ev.get("location") or {}
        coords = loc.get("coordinates") or {}
        products = (tickets(latest(con, run, code, "tickets"), base)
                    + guestlists(latest(con, run, code, "guestlists"), base)
                    + zones(latest(con, run, code, "zones"), base, code))
        events.append({
            "code": code,
            "id": ev["id"],
            "name": clean(ev.get("name")),
            "venue": clean((ev.get("organization") or {}).get("name")),
            "venue_slug": (ev.get("organization") or {}).get("slug"),
            "club_id": CLUBS.get((clean((ev.get("organization") or {}).get("name")) or "").lower())
                       or auto_link(con, clean((ev.get("organization") or {}).get("name")) or "",
                                    coords.get("latitude"), coords.get("longitude")),
            "address": clean(loc.get("addressComplete")),
            "lat": coords.get("latitude"),
            "lng": coords.get("longitude"),
            "night": night_of(dates["start"]),
            "starts_at": iso(dates["start"]),
            "ends_at": iso(dates.get("end")),
            "doors": hhmm(dates["start"]),
            "closes": hhmm(dates.get("end")),
            "sale_ends": iso(dates.get("limitSale")),
            "min_age": ev.get("age"),
            "genres": ev.get("musicalGenres") or [],
            "image": (ev.get("images") or {}).get("medium") or ev.get("image"),
            "currency": ev.get("currency") or "EUR",
            "url": base,
            "products": products,
        })

    # Plan images → our Storage, and each night's overview layout.
    urls = {p["map"]["image"] for e in events for p in e["products"]
            if p.get("map") and p["map"].get("image")}
    images = plan_images(con, urls)
    painted: dict[tuple[str, str], bool] = {}
    for e in events:
        zs = [p for p in e["products"] if p["settle"] == "table"]
        for p in zs:
            m = p.get("map")
            if m and m.get("image") in images:
                src = m["image"]
                key = (src, json.dumps([(x["left"], x["top"], x.get("rgb")) for x in m["spaces"]]))
                # Same rules for every map:
                #  align  — one shift for the whole map if that puts more
                #           tables on their price colours;
                #  fit    — the venue's points land on drawn tables;
                #  drawn  — the plan draws its tables (price colours present);
                #  → fit: trace outlines · drawn but no fit: approximate (the
                #    app marks nothing) · nothing drawn: the app draws shapes.
                align_positions(src, m["spaces"])
                if key not in painted:
                    painted[key] = tables_painted(src, m["spaces"])
                if painted[key]:
                    m["painted"] = True
                    snap_tables(src, m["spaces"])
                    # Drawn tables but not one traced: the points don't
                    # describe this picture — approximate, mark nothing.
                    if not any(sp.get("box") for sp in m["spaces"]):
                        m["approx"] = True
                elif colours_drawn(src, m["spaces"]) >= 0.7:
                    m["painted"] = True
                    m["approx"] = True
                else:
                    m["painted"] = False
                m["image"] = images[src][0]
        lay = vip_layout(zs, {images[u][0]: images[u] for u in images})
        if lay:
            e["vip_map"] = lay

    events.sort(key=lambda e: e["starts_at"])
    out = {"channel": channel, "run": run,
           "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "events": events}
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1))

    settles: dict[str, int] = {}
    for e in events:
        for p in e["products"]:
            settles[p["settle"]] = settles.get(p["settle"], 0) + 1
    print(f"run {run}: {len(events)} events → {args.out}  {settles}")

    # Audit — what a human would otherwise check by eye, every run.
    audit: dict[str, dict] = {}
    for e in events:
        a = audit.setdefault(e["venue"] or "?", {"nights": 0, "linked": bool(e.get("club_id")), "zones": 0,
                                                 "mapped": 0, "approx": 0, "tables": 0, "traced": 0, "drawn": 0})
        a["nights"] += 1
        for p in e["products"]:
            if p["settle"] != "table":
                continue
            a["zones"] += 1
            m = p.get("map") or {}
            if m.get("spaces"):
                a["mapped"] += 1
                if m.get("approx"):
                    a["approx"] += 1
                elif m.get("painted"):
                    a["tables"] += len(m["spaces"])
                    a["traced"] += sum(1 for sp in m["spaces"] if sp.get("box"))
                else:
                    a["drawn"] += len(m["spaces"])
    (args.out.parent / "audit.json").write_text(json.dumps(audit, indent=1, ensure_ascii=False))
    flags = []
    for v, a in sorted(audit.items()):
        if not a["linked"]:
            flags.append(f"{v}: not linked to a club (its nights can't show)")
        if a["zones"] and a["mapped"] < a["zones"]:
            flags.append(f"{v}: {a['zones'] - a['mapped']}/{a['zones']} table zones without a map")
        if a["approx"]:
            flags.append(f"{v}: {a['approx']} map(s) approximate (positions don't fit the plan)")
        if a["tables"] and a["traced"] / a["tables"] < 0.5:
            flags.append(f"{v}: only {a['traced']}/{a['tables']} drawn tables traced (dots shown)")
    print("audit: " + ("; ".join(flags) if flags else "all venues linked and mapped"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
