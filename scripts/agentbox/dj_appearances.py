#!/usr/bin/env python3
"""Scrape each catalogued DJ's upcoming dates and push them to Supabase.

WHY THIS EXISTS SEPARATELY FROM `events`
    public.events is filtered to Barcelona (areas: {eq: BCN_AREA_ID}) — it is
    the city's calendar. A DJ's own run is not: a Barcelona resident may play
    Berlin next Friday, and showing that is the point of a timeline. RA's
    `Artist.events` is per-artist and unfiltered by area, so it gives us the
    whole run, including cities we do not operate in.

    Rows whose venue resolves to one of our clubs carry `club_id`; those are the
    nights a user can act on. Everything else is displayed but not bookable —
    the app shows a "coming soon" note for that city rather than linking out.

Run after the DJ catalogue refresh:  ~/scraper/venv/bin/python dj_appearances.py
Flags: --limit N (artists per run)   --dry-run (fetch + report, write nothing)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import pathlib
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path.home() / "scraper"
DJS_DB = ROOT / "intel/events/djs.sqlite"
SUPABASE_ENV = ROOT / "secrets/supabase.env"
RA_GQL = "https://ra.co/graphql"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"

# How far ahead a timeline is worth showing, and how many artists to refresh per
# run. RA is not aggressively rate-limited but this is a courtesy crawl.
HORIZON_DAYS = 120
DEFAULT_LIMIT = 400
SLEEP_BETWEEN = 0.25
BATCH = 200

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s dj_appearances %(levelname)s %(message)s")
log = logging.getLogger("dj_appearances")


def ra_query(query: str, variables: dict | None = None, timeout: int = 30) -> dict:
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        RA_GQL, data=body,
        headers={"Content-Type": "application/json", "User-Agent": UA,
                 "Referer": "https://ra.co/"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


ARTIST_EVENTS = """
query ($id: ID!, $limit: Int!) {
  artist(id: $id) {
    id
    events(type: LATEST, limit: $limit) {
      id title date startTime
      venue { id name area { name country { name } } }
    }
  }
}"""


def supabase_env() -> tuple[str, str]:
    base = key = ""
    for line in SUPABASE_ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if k.strip() in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"):
            base = v
        elif k.strip() in ("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"):
            key = v
    if not base or not key:
        raise SystemExit(f"missing SUPABASE_URL / SERVICE_ROLE_KEY in {SUPABASE_ENV}")
    return base.rstrip("/"), key


def sb(method: str, path: str, base: str, key: str,
       body: bytes | None = None, extra_headers: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(f"{base}/rest/v1/{path}", data=body, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    for h, v in (extra_headers or {}).items():
        req.add_header(h, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def load_club_index(base: str, key: str) -> dict[str, str]:
    """Normalised club name -> id, for the venues we actually carry.

    Deliberately an EXACT normalised match, not the fuzzy venue matcher: a
    wrong club_id here would make an away night look bookable and send someone
    to the wrong door. When in doubt the row stays unbookable, which the UI
    already handles gracefully.
    """
    out: dict[str, str] = {}
    offset = 0
    while True:
        status, text = sb("GET",
                          f"clubs?select=id,name&is_active=eq.true&offset={offset}&limit=1000",
                          base, key)
        if status != 200:
            log.warning("clubs fetch failed %s: %s", status, text[:200])
            break
        rows = json.loads(text)
        for c in rows:
            n = normalise(c.get("name") or "")
            if n and n not in out:
                out[n] = c["id"]
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def normalise(s: str) -> str:
    import re
    import unicodedata
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", s.lower())).strip()


def known_artist_ids(base: str, key: str) -> set[str]:
    """ra_artist_id values that exist in Supabase `djs` — the FK target."""
    out: set[str] = set()
    offset = 0
    while True:
        status, text = sb("GET", f"djs?select=ra_artist_id&offset={offset}&limit=1000",
                          base, key)
        if status != 200:
            log.warning("djs fetch failed %s: %s", status, text[:200])
            break
        rows = json.loads(text)
        out.update(str(r["ra_artist_id"]) for r in rows if r.get("ra_artist_id"))
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def featured_artist_ids(base: str, key: str) -> list[str]:
    """DJs currently surfaced on a club page (active club_dj_sets slots).

    These come FIRST regardless of follower count: they are the only DJs a user
    can actually reach in the app, and they are mostly local residents who rank
    nowhere near the top of the catalogue by followers.
    """
    status, text = sb("GET", "club_dj_sets?select=ra_artist_id&is_active=eq.true",
                      base, key)
    if status != 200:
        log.warning("club_dj_sets fetch failed %s: %s", status, text[:200])
        return []
    seen, out = set(), []
    for row in json.loads(text):
        rid = row.get("ra_artist_id")
        if rid and rid not in seen:
            seen.add(rid)
            out.append(str(rid))
    return out


def catalogue_artists(limit: int, base: str, key: str) -> list[tuple[str, str]]:
    """(ra_id, name) to refresh: every featured DJ first, then the most-followed
    of the rest until `limit` is reached."""
    c = sqlite3.connect(DJS_DB)
    c.row_factory = sqlite3.Row
    names = {str(r["ra_id"]): r["name"] for r in
             c.execute("select ra_id, name from djs where ra_id is not null")}
    ranked = [str(r["ra_id"]) for r in c.execute(
        "select ra_id from djs where ra_id is not null "
        "order by coalesce(ra_followers,0) desc")]
    c.close()

    ordered, seen = [], set()
    for rid in featured_artist_ids(base, key) + ranked:
        if rid in seen:
            continue
        seen.add(rid)
        ordered.append((rid, names.get(rid, rid)))
        if len(ordered) >= limit:
            break
    return ordered


def fetch_appearances(ra_id: str) -> list[dict]:
    try:
        d = ra_query(ARTIST_EVENTS, {"id": ra_id, "limit": 40})
    except Exception as e:                       # network / RA hiccup
        log.debug("  artist %s failed: %s", ra_id, e)
        return []
    if "errors" in d:
        return []
    artist = (d.get("data") or {}).get("artist") or {}
    return artist.get("events") or []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                    help="artists to refresh this run")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base, key = supabase_env()
    clubs = load_club_index(base, key)
    log.info("club index: %d active venues", len(clubs))

    # The box's catalogue runs ahead of Supabase's `djs` (push_djs.py is a
    # separate step), and dj_appearances.ra_artist_id is a FK onto it. Appearances
    # for an artist we have not pushed yet have nowhere to hang and would fail the
    # whole batch — skip them; the next run picks them up once the DJ is pushed.
    known = known_artist_ids(base, key)
    log.info("djs in Supabase: %d", len(known))

    artists = catalogue_artists(args.limit, base, key)
    log.info("refreshing %d artists (featured DJs first)", len(artists))

    today = dt.date.today()
    horizon = today + dt.timedelta(days=HORIZON_DAYS)
    payload: list[dict] = []
    local = away = 0

    skipped_unknown = 0
    for i, (ra_id, name) in enumerate(artists, 1):
        if ra_id not in known:
            skipped_unknown += 1
            continue
        for e in fetch_appearances(ra_id):
            date = (e.get("date") or "")[:10]
            if not date:
                continue
            try:
                d = dt.date.fromisoformat(date)
            except ValueError:
                continue
            if not (today <= d <= horizon):
                continue
            venue = e.get("venue") or {}
            area = venue.get("area") or {}
            venue_name = venue.get("name") or ""
            club_id = clubs.get(normalise(venue_name))
            if club_id:
                local += 1
            else:
                away += 1
            payload.append({
                "ra_artist_id": ra_id,
                "ra_event_id": str(e.get("id")),
                "title": e.get("title"),
                "date": date,
                "start_time": e.get("startTime"),
                "venue_name": venue_name or None,
                "city": area.get("name"),
                "country": (area.get("country") or {}).get("name"),
                "club_id": club_id,
            })
        if i % 50 == 0:
            log.info("  %d/%d artists, %d appearances so far", i, len(artists), len(payload))
        time.sleep(SLEEP_BETWEEN)

    # One artist can appear on the same event twice (b2b credits); the table's
    # PK is (ra_artist_id, ra_event_id), so collapse before sending.
    deduped = {(p["ra_artist_id"], p["ra_event_id"]): p for p in payload}
    rows = list(deduped.values())
    log.info("%d appearances (%d at our venues, %d elsewhere) across %d artists"
             "%s", len(rows), local, away, len(artists) - skipped_unknown,
             f"; skipped {skipped_unknown} not yet in Supabase djs" if skipped_unknown else "")

    if args.dry_run:
        log.info("--dry-run: nothing written. Sample: %s",
                 json.dumps(rows[0], ensure_ascii=False) if rows else "none")
        return 0

    written = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        status, text = sb(
            "POST", "dj_appearances?on_conflict=ra_artist_id,ra_event_id",
            base, key, json.dumps(chunk).encode(),
            {"Prefer": "resolution=merge-duplicates,return=minimal"})
        if status >= 300:
            log.error("batch %d failed %s: %s", i // BATCH, status, text[:300])
            return 1
        written += len(chunk)
    log.info("pushed %d appearances", written)
    return 0


if __name__ == "__main__":
    sys.exit(main())
