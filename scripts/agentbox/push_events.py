#!/usr/bin/env python3
"""Push the scraped Barcelona event calendar into Supabase.

DEPLOYED TO THE AGENTBOX — this file lives at ~/scraper/push_events.py on
10.0.0.235 and runs from its cron. The copy here is for version control;
after editing, redeploy with:

    scp scripts/agentbox/push_events.py yvinnik@10.0.0.235:~/scraper/push_events.py

Why it runs there and not in the cloud: 10.0.0.235 is a LAN address, so
Vercel/Supabase cron cannot reach it. The box already refreshes the calendar
daily and already holds the service-role key, so it pushes outward instead
(EVENTS_INGEST_BRIEF.md §8).

Reads events.sqlite (the source of truth, including past events) and upserts
into public.events on ra_event_id. Idempotent: first_seen is never
overwritten and nothing is ever deleted — events drop out of the scraper's
rolling window by ageing past the horizon, not by being cancelled.

Mirrors scripts/ingest-events.mjs in the app repo; the venue resolver in
particular must stay identical in both. Usage:

    ~/scraper/venv/bin/python3 ~/scraper/push_events.py [--dry-run] [--quiet]
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
SQLITE = ROOT / "intel" / "events" / "events.sqlite"
SECRETS = ROOT / "secrets" / "supabase.env"
MADRID = ZoneInfo("Europe/Madrid")
BATCH = 100

log = logging.getLogger("push_events")


def supabase_env() -> tuple[str, str]:
    """Same parse as nightly_research._supabase_env()."""
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


# ── Venue resolution ─────────────────────────────────────────────────────────
# Deliberately conservative: only writes a club_id it is confident about, and
# leaves the rest NULL with venue_name kept for a later backfill. Two rules,
# both requiring a unique winner:
#   exact  normalised names identical
#   core   the venue's distinctive tokens are a SUBSET of the club's AND both
#          lead with the same token
# The subset direction and leading-token check are load bearing — without them
# "Bonavista Rooftop" resolves to "Bodega Bonavista" and "Teatre Grec" to
# "Bar Teatre". Keep in lockstep with buildResolver() in ingest-events.mjs.

GENERIC = {
    "club", "bar", "barcelona", "the", "disco", "discoteca", "sala", "lounge",
    "hotel", "cafe", "restaurant", "beach", "rooftop", "terrace", "terraza",
    "music", "night", "bcn", "de", "la", "el", "los", "las", "and", "pub",
    "room", "studio", "garden", "sky",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def core(s: str) -> list[str]:
    return [t for t in norm(s).split() if len(t) > 1 and t not in GENERIC]


class Resolver:
    def __init__(self, clubs: list[dict]) -> None:
        self.by_norm: dict[str, list[dict]] = {}
        self.indexed: list[tuple[dict, list[str]]] = []
        for c in clubs:
            self.by_norm.setdefault(norm(c["name"]), []).append(c)
            self.indexed.append((c, core(c["name"])))

    @staticmethod
    def _pick(pool: list[dict]) -> dict | None:
        """Prefer active rows; refuse to guess when several remain."""
        active = [c for c in pool if c.get("is_active")]
        chosen = active or pool
        if len({c["id"] for c in chosen}) > 1:
            return None
        return chosen[0]

    def resolve(self, venue: str) -> tuple[dict | None, str | None]:
        n, k = norm(venue), core(venue)
        if n in self.by_norm:
            hit = self._pick(self.by_norm[n])
            if hit:
                return hit, "exact"
        if not k:
            return None, None
        ks = set(k)
        hits = [c for c, ck in self.indexed if ck and ck[0] == k[0] and ks <= set(ck)]
        if not hits:
            return None, None
        hit = self._pick(hits)
        return (hit, "core") if hit else (None, None)


# ── Row shaping ──────────────────────────────────────────────────────────────

def madrid_iso(naive: str | None) -> str | None:
    """RA reports naive LOCAL wall-clock ("...T23:00:00.000").

    Handing that to a timestamptz column makes Postgres read it as UTC, which
    stores a 23:00 door as 01:00 the next morning — 2h late in summer, 1h in
    winter. Attaching the Madrid zone resolves the correct instant, DST and all.
    """
    if not naive:
        return None
    try:
        return dt.datetime.fromisoformat(naive.replace("Z", "")).replace(
            tzinfo=MADRID).isoformat()
    except ValueError:
        log.warning("unparseable start_time %r — storing null", naive)
        return None


def split_list(s: str | None) -> list[str]:
    return [v.strip() for v in (s or "").split("|") if v.strip()]


def to_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    logging.basicConfig(
        level=logging.WARNING if "--quiet" in sys.argv else logging.INFO,
        format="%(asctime)s push_events %(levelname)s %(message)s",
    )

    if not SQLITE.exists():
        log.error("no events.sqlite at %s", SQLITE)
        return 1

    conn = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    # Everything, not just the forward window: past events are cheap to keep
    # and give the app a real history to reason about.
    rows = [dict(r) for r in conn.execute("SELECT * FROM events ORDER BY date")]
    conn.close()
    if not rows:
        log.error("events.sqlite is empty — refusing to push")
        return 1

    base, key = supabase_env()
    clubs = fetch_all(base, key, "clubs?select=id,name,is_active&order=id.asc")
    resolver = Resolver(clubs)

    # first_seen must survive re-pushes (brief §6).
    existing = {
        e["ra_event_id"]: e["first_seen"]
        for e in fetch_all(base, key, "events?select=ra_event_id,first_seen&order=ra_event_id.asc")
    }

    payload, matched = [], 0
    for r in rows:
        club, how = resolver.resolve(r["venue"] or "")
        if how:
            matched += 1
        payload.append({
            "ra_event_id": r["id"],
            "title":       r["title"] or "",
            "date":        r["date"],
            "start_time":  madrid_iso(r["start_time"]),
            "venue_name":  r["venue"] or "",
            "club_id":     club["id"] if club else None,
            "club_match":  how,
            "promoters":   split_list(r["promoters"]),
            "artists":     split_list(r["artists"]),
            "interested":  to_int(r["interested"]),
            "attending":   to_int(r["attending"]),
            "cost":        r["cost"] or None,
            "ra_url":      r["ra_url"] or None,
            # Front flyer + event copy, written by nightly_research.py. Read with
            # .get() so an older events.sqlite that predates those columns still
            # pushes rather than raising; RA leaves both empty on plenty of
            # events, so null here is normal, not a failure.
            "image":       (r.get("image") or None),
            "description": (r.get("description") or None),
            "first_seen":  existing.get(r["id"]) or r["first_seen"],
            "last_seen":   r["last_seen"],
        })

    log.info("%d events (%d resolved to a club), %d clubs, %d already in Supabase",
             len(payload), matched, len(clubs), len(existing))

    if dry_run:
        log.info("--dry-run: nothing written. Sample: %s",
                 json.dumps(payload[0], ensure_ascii=False)[:400])
        return 0

    written = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        try:
            request(f"{base}/rest/v1/events?on_conflict=ra_event_id", key,
                    method="POST",
                    body=json.dumps(chunk, ensure_ascii=False).encode(),
                    prefer="resolution=merge-duplicates,return=minimal")
        except urllib.error.HTTPError as e:
            log.error("upsert failed at row %d: %s %s", i, e.code, e.read()[:400])
            return 1
        written += len(chunk)

    log.info("pushed %d events (%d new)", written, len(payload) - len(existing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
