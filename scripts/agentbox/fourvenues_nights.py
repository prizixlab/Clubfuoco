#!/usr/bin/env python3
"""Keep HypeList's normal events (`promoter_nights`) in step with Fourvenues.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/fourvenues_nights.py and runs
from cron right after fourvenues_push.py. Redeploy:

    scp scripts/agentbox/fourvenues_nights.py agentbox:~/scraper/fourvenues_nights.py

The app sells HypeList's nights from the hourly Fourvenues feed
(intel/fourvenues/offers.json). The portal shows a promoter's nights from
`promoter_nights`. This makes them one calendar: every feed event becomes, or
updates, a night owned by HypeList's account, keyed by its Fourvenues code and
carrying a snapshot of its ways in (guestlists, door, tickets, table zones).

Matching an event to a night, in order:
  1. same fourvenues_code;
  2. same venue + night + title (case and punctuation ignored) — the nights
     scripts/import-hypelist-events.mjs loaded on 17 Sep, before codes existed;
  3. the ONLY uncoded night at that venue that night, when the feed also has
     only one event there — a renamed night ("PLAYFUL" → "PLAYFUL OKTOBER FEST").
Otherwise a new night is created.

What it owns on a night: title, times, the code and the snapshot. What it
never touches: publishing, review, featuring, pinning, visibility, price —
those are the operator's (Events desk). New nights are created published and
approved, like the import: an operator load, not a promoter submission, so the
before-insert trigger's 'pending' is lifted right after.

Nights that drop out of the feed are left alone (a missed scrape must not
unpublish a real night).

Needs migration 20261002_promoter_nights_fourvenues.sql. Until it is applied
this prints a note and exits 0, so the cron line keeps working.

Usage:
    ~/scraper/venv/bin/python3 ~/scraper/fourvenues_nights.py [--dry-run]
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OFFERS = ROOT / "intel" / "fourvenues" / "offers.json"
SECRETS = ROOT / "secrets" / "supabase.env"
BRAND_KEY = "hypelist"


def supabase_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


class Rest:
    def __init__(self, base: str, key: str):
        self.base, self.key = base, key

    def __call__(self, method: str, path: str, body=None, prefer: str | None = None):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
                   "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}/rest/v1/{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()[:400]


def norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def snapshot(e: dict, previous: dict | None = None) -> dict:
    """The ways in, compact — what the portal shows under the night.

    A product that was on sale last run and is gone now is kept, marked
    unavailable: the operator should see that a list closed or a zone was
    pulled, not have it silently vanish.
    """
    products = []
    for p in e.get("products") or []:
        item = {"name": p.get("name"), "settle": p.get("settle"), "price": p.get("price"),
                "sold_out": bool(p.get("sold_out"))}
        if p.get("sale_starts"):
            item["sale_starts"] = p["sale_starts"]
        if p.get("detail"):
            item["detail"] = p["detail"]
        rates = []
        for r in p.get("rates") or []:
            pax = [n for n in (r.get("pax") or []) if n]
            rates.append({"name": r.get("name"), "price": r.get("price"),
                          "pax": [min(pax), max(pax)] if pax else None,
                          "deposit": r.get("deposit"), "deposit_type": r.get("deposit_type"),
                          "full_payment": bool(r.get("full_payment"))})
        if rates:
            item["rates"] = rates
        products.append(item)
    now = {(p["name"], p["settle"]) for p in products}
    for old in (previous or {}).get("products") or []:
        if (old.get("name"), old.get("settle")) not in now:
            products.append({**old, "unavailable": True})
    return {"url": e.get("url"), "image": e.get("image"), "min_age": e.get("min_age"),
            "venue": e.get("venue"), "products": products,
            "seen_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def main() -> int:
    """One pass per brand: each brand's nights are filed under its own
    promoter account, so its portal Events/Revenue and the app credit the
    right seller. Events with no `brand` (a pre-multi-channel feed) are
    HypeList's, the only channel there was."""
    dry = "--dry-run" in sys.argv
    feed = json.loads(OFFERS.read_text())
    events = [e for e in feed.get("events", []) if e.get("code") and e.get("night")]
    if not events:
        print("nights: feed has no events — nothing to do")
        return 0
    rest = Rest(*supabase_env())
    worst = 0
    for brand_key in sorted({e.get("brand") or BRAND_KEY for e in events}):
        mine = [e for e in events if (e.get("brand") or BRAND_KEY) == brand_key]
        worst = max(worst, sync_brand(rest, brand_key, mine, dry))
    return worst


def sync_brand(rest: "Rest", brand_key: str, events: list[dict], dry: bool) -> int:
    st, brands = rest("GET", f"partner_brands?key=eq.{brand_key}&select=id,owner_user_id")
    if st != 200 or not brands or not brands[0].get("owner_user_id"):
        print(f"nights: no {brand_key} brand with an owner ({st}) — skipped")
        return 0
    owner = brands[0]["owner_user_id"]

    since = min(e["night"] for e in events)
    st, rows = rest("GET", "promoter_nights?select=id,club_id,location_name,title,night_date,fourvenues_code,fourvenues,photo_urls"
                    f"&created_by=eq.{owner}&night_date=gte.{since}&limit=5000")
    if st != 200:
        if "fourvenues_code" in str(rows):
            print("nights: migration 20261002_promoter_nights_fourvenues.sql not applied yet — skipped")
            return 0
        print(f"nights: could not read promoter_nights ({st}): {rows}")
        return 1

    by_code = {r["fourvenues_code"]: r for r in rows if r.get("fourvenues_code")}
    place = lambda club, loc: club or f"loc:{norm(loc)}"
    nights_at = defaultdict(list)            # (place, night) → uncoded nights
    for r in rows:
        if not r.get("fourvenues_code"):
            nights_at[(place(r["club_id"], r.get("location_name")), r["night_date"])].append(r)
    feed_at = defaultdict(int)
    for e in events:
        feed_at[(place(e.get("club_id"), e.get("venue")), e["night"])] += 1

    claimed: set[str] = set()
    updates, inserts = [], []
    for e in events:
        key = (place(e.get("club_id"), e.get("venue")), e["night"])
        hit = by_code.get(e["code"])
        if not hit:
            cands = [r for r in nights_at.get(key, []) if r["id"] not in claimed]
            hit = next((r for r in cands if norm(r["title"]) == norm(e.get("name"))), None)
            if not hit and len(cands) == 1 and feed_at[key] == 1:
                hit = cands[0]
        fields = {"title": e.get("name") or "Untitled night", "open_time": e.get("doors"),
                  "close_time": e.get("closes"), "fourvenues_code": e["code"],
                  "fourvenues": snapshot(e, hit.get("fourvenues") if hit else None)}
        if hit:
            claimed.add(hit["id"])
            # A venue linked to a club since the night was created (Nu Bcn,
            # Duvet): attach the club now.
            if e.get("club_id") and not hit.get("club_id"):
                fields["club_id"] = e["club_id"]
            # The poster. Only inserts used to set it, so every night created
            # before it had one (or matched by name) stayed on the venue photo.
            if e.get("image") and not hit.get("photo_urls"):
                fields["photo_urls"] = [e["image"]]
            updates.append((hit["id"], fields, hit.get("fourvenues_code") is None))
        else:
            row = {**fields, "night_date": e["night"], "created_by": owner, "is_published": True,
                   "visibility": "public", "price_cents": 0, "currency": "eur", "is_house": False,
                   "featured": False}
            if e.get("club_id"):
                row["club_id"] = e["club_id"]
            else:                                  # a room with no clubs row (Nu Bcn)
                row.update({"location_name": e.get("venue"), "address": e.get("address"),
                            "lat": e.get("lat"), "lng": e.get("lng")})
            if e.get("image"):
                row["photo_urls"] = [e["image"]]
            inserts.append(row)

    linked = sum(1 for _, _, first in updates if first)
    print(f"nights[{brand_key}]: {len(events)} feed events → {len(updates)} existing nights "
          f"({linked} newly linked), {len(inserts)} new")
    if dry:
        for r in inserts[:15]:
            print(f"   + {r['night_date']} {r.get('club_id') or r.get('location_name')}  {r['title']}")
        print("DRY RUN — nothing written")
        return 0

    failed = updated = 0
    for nid, fields, _ in updates:
        st, body = rest("PATCH", f"promoter_nights?id=eq.{nid}", fields, prefer="return=minimal")
        if st >= 300:
            failed += 1
            print(f"   ! update {fields['fourvenues_code']}: {body}")
        else:
            updated += 1
    new_ids = []
    for row in inserts:
        st, body = rest("POST", "promoter_nights?select=id", row, prefer="return=representation")
        if st >= 300:
            failed += 1
            print(f"   ! insert {row['fourvenues_code']} {row['title']}: {body}")
        else:
            new_ids.append(body[0]["id"])
    # The before-insert trigger parks new nights at 'pending'; lift them.
    for i in range(0, len(new_ids), 100):
        ids = ",".join(new_ids[i:i + 100])
        rest("PATCH", f"promoter_nights?id=in.({ids})", {"review_status": "approved"}, prefer="return=minimal")
    print(f"nights[{brand_key}]: wrote {updated} updates, {len(new_ids)} inserts, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
