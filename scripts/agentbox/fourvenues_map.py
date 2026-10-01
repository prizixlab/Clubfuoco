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
        window = " ".join(filter(None, [
            clean(s.get("duration")) for s in g.get("summary") or []] + [
            clean(s.get("until")) for s in g.get("summary") or []]))
        includes = next((clean(o.get("content")) for o in opts if clean(o.get("content"))), None)
        out.append({
            "id": g["id"],
            "source": "guestlist",
            "name": clean(g.get("name")),
            "detail": " · ".join(filter(None, [window or None, includes])),
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


def zones(data: list, base: str) -> list[dict]:
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
                    + zones(latest(con, run, code, "zones"), base))
        events.append({
            "code": code,
            "id": ev["id"],
            "name": clean(ev.get("name")),
            "venue": clean((ev.get("organization") or {}).get("name")),
            "venue_slug": (ev.get("organization") or {}).get("slug"),
            "club_id": CLUBS.get((clean((ev.get("organization") or {}).get("name")) or "").lower()),
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
