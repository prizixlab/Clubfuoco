#!/usr/bin/env python3
"""Classify DJ-only events and surface them as Featured DJ boxes.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/link_djs.py on 10.0.0.235 and runs
from cron after push_events.py (writes events + club_id + artists) and
push_djs.py (writes the DJ catalogue). Redeploy edits with:

    scp scripts/agentbox/link_djs.py yvinnik@10.0.0.235:~/scraper/link_djs.py

THE RULE: an upcoming event that resolves to a club and has EXACTLY ONE artist,
where that artist matches a row in `djs`, is "really just a DJ playing" — not a
real event. Concerts, dancers, multi-artist parties and genre-only format nights
(no single named DJ) stay as events. For each DJ night we:

  1. set events.is_dj_set = true   → the app hides that event card
  2. write a source='auto' club_dj_sets slot → the DJ shows as a Featured DJ box

Idempotent: resets is_dj_set across the upcoming window each run, and fully
rewrites its own source='auto' slots. Curated source='manual' slots are never
touched. Reads everything from Supabase (not the local sqlite) so it uses the
same club_id resolution push_events already computed.

Usage: ~/scraper/venv/bin/python3 ~/scraper/link_djs.py [--dry-run] [--quiet]
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import logging
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
SECRETS = ROOT / "secrets" / "supabase.env"
MADRID = ZoneInfo("Europe/Madrid")
BATCH = 100
WEEKDAY = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays",
           "Fridays", "Saturdays", "Sundays"]

log = logging.getLogger("link_djs")


def supabase_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def request(url: str, key: str, *, method: str = "GET",
            body: bytes | None = None, prefer: str | None = None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def fetch_all(base: str, key: str, path: str) -> list[dict]:
    out: list[dict] = []
    offset, page = 0, 1000
    while True:
        rows = request(f"{base}/rest/v1/{path}&limit={page}&offset={offset}", key)
        out.extend(rows)
        if len(rows) < page:
            return out
        offset += page


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def weekday_label(date: str) -> str | None:
    try:
        return WEEKDAY[dt.date.fromisoformat(date).weekday()]
    except (ValueError, TypeError):
        return None


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    logging.basicConfig(
        level=logging.WARNING if "--quiet" in sys.argv else logging.INFO,
        format="%(asctime)s link_djs %(levelname)s %(message)s",
    )
    base, key = supabase_env()
    today = dt.datetime.now(MADRID).date().isoformat()

    # DJ name → id. Drop names that map to >1 id (collisions): matching those
    # by name would guess wrong, so we skip them (brief §8).
    name_ids: dict[str, set[str]] = collections.defaultdict(set)
    dj_name: dict[str, str] = {}
    for d in fetch_all(base, key, "djs?select=ra_artist_id,name&order=ra_artist_id.asc"):
        n = norm(d["name"])
        if n:
            name_ids[n].add(d["ra_artist_id"])
            dj_name[d["ra_artist_id"]] = d["name"]
    lookup = {n: next(iter(ids)) for n, ids in name_ids.items() if len(ids) == 1}
    log.info("%d DJs (%d unique names usable for matching)", len(dj_name), len(lookup))

    # Upcoming, club-resolved events with their lineup.
    events = fetch_all(
        base, key,
        f"events?select=ra_event_id,club_id,artists,date"
        f"&club_id=not.is.null&date=gte.{today}&order=date.asc")

    dj_event_ids: list[str] = []                  # events to hide
    # (club_id, ra_artist_id) → list of dates  → one slot per DJ per club
    slots: dict[tuple[str, str], list[str]] = collections.defaultdict(list)
    for e in events:
        arts = [a for a in (e.get("artists") or []) if a and a.strip()]
        if len(arts) != 1:                        # 0 = genre-only; 2+ = a real event
            continue
        rid = lookup.get(norm(arts[0]))
        if not rid:                               # single act, but not a DJ we know (concert/dancer)
            continue
        dj_event_ids.append(e["ra_event_id"])
        slots[(e["club_id"], rid)].append(e["date"])

    log.info("%d upcoming club events → %d are DJ-only (%d distinct DJ×club slots)",
             len(events), len(dj_event_ids), len(slots))

    # Don't disturb curated slots: skip auto rows that collide with a manual one.
    manual = {
        (s["club_id"], s["ra_artist_id"])
        for s in fetch_all(base, key, "club_dj_sets?select=club_id,ra_artist_id,source")
        if s.get("source") != "auto"
    }

    auto_rows = []
    for (club_id, rid), dates in slots.items():
        if (club_id, rid) in manual:
            continue
        dates.sort()
        # Most common weekday across this DJ's nights here; resident if it recurs.
        wk = collections.Counter(weekday_label(d) for d in dates if weekday_label(d))
        night = wk.most_common(1)[0][0] if wk else None
        auto_rows.append({
            "club_id": club_id,
            "ra_artist_id": rid,
            "residency_label": "Resident" if len(dates) >= 3 else "Guest",
            "night": night,
            "source": "auto",
            "sort": 0,
        })

    if dry_run:
        sample = [f'{dj_name.get(r["ra_artist_id"], "?")} @ {r["club_id"][:8]}… '
                  f'({r["residency_label"]}·{r["night"]})' for r in auto_rows[:8]]
        log.info("--dry-run: would hide %d events, write %d auto slots (%d skipped as manual). Sample: %s",
                 len(dj_event_ids), len(auto_rows), len(slots) - len(auto_rows), sample)
        return 0

    # 1) Reset the window, then flag the DJ-only events.
    reset = f"{base}/rest/v1/events?date=gte.{today}&is_dj_set=eq.true"
    request(reset, key, method="PATCH",
            body=json.dumps({"is_dj_set": False}).encode(),
            prefer="return=minimal")
    for i in range(0, len(dj_event_ids), BATCH):
        ids = ",".join(dj_event_ids[i:i + BATCH])
        request(f"{base}/rest/v1/events?ra_event_id=in.({ids})", key, method="PATCH",
                body=json.dumps({"is_dj_set": True}).encode(),
                prefer="return=minimal")

    # 2) Rewrite our own auto slots (leaving manual/curated ones alone).
    request(f"{base}/rest/v1/club_dj_sets?source=eq.auto", key,
            method="DELETE", prefer="return=minimal")
    for i in range(0, len(auto_rows), BATCH):
        chunk = auto_rows[i:i + BATCH]
        try:
            request(f"{base}/rest/v1/club_dj_sets", key, method="POST",
                    body=json.dumps(chunk, ensure_ascii=False).encode(),
                    prefer="return=minimal")
        except urllib.error.HTTPError as e:
            log.error("slot insert failed at %d: %s %s", i, e.code, e.read()[:300])
            return 1

    log.info("hid %d DJ-only events, wrote %d auto DJ slots", len(dj_event_ids), len(auto_rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
