#!/usr/bin/env python3
"""Push the enriched Barcelona DJ / artist catalogue into Supabase.

DEPLOYED TO THE AGENTBOX — this file lives at ~/scraper/push_djs.py on
10.0.0.235 and runs from its cron. The copy here is for version control;
after editing, redeploy with:

    scp scripts/agentbox/push_djs.py yvinnik@10.0.0.235:~/scraper/push_djs.py

Why it runs there and not in the cloud: 10.0.0.235 is a LAN address, so
Vercel/Supabase cron cannot reach it. The box already refreshes the DJ table
(RA-only, no rate-limit holes) and already holds the service-role key, so it
pushes outward instead (DJS_INGEST_BRIEF.md §6).

Reads djs.sqlite (source of truth, table `djs`, PK = RA artist id) and upserts
into public.djs on ra_artist_id. Idempotent: first_seen is never overwritten
(sqlite keeps it fixed) and nothing is ever deleted — a DJ who stops being
booked just stops appearing on new events, the catalogue row stays.

Sibling of push_events.py; shares its creds parse, request helper and batching.
Usage:

    ~/scraper/venv/bin/python3 ~/scraper/push_djs.py [--dry-run] [--quiet]
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SQLITE = ROOT / "intel" / "events" / "djs.sqlite"
SECRETS = ROOT / "secrets" / "supabase.env"
BATCH = 100

log = logging.getLogger("push_djs")


def supabase_env() -> tuple[str, str]:
    """Same parse as push_events.supabase_env()."""
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


def split_list(s: str | None) -> list[str]:
    """Pipe-joined multi-value fields (`A | B | C`) → array, blanks dropped."""
    return [v.strip() for v in (s or "").split("|") if v.strip()]


def to_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def clean(v) -> str | None:
    """Empty string / whitespace → None (keeps optional columns truly null)."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    logging.basicConfig(
        level=logging.WARNING if "--quiet" in sys.argv else logging.INFO,
        format="%(asctime)s push_djs %(levelname)s %(message)s",
    )

    if not SQLITE.exists():
        log.error("no djs.sqlite at %s", SQLITE)
        return 1

    conn = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM djs ORDER BY CAST(ra_followers AS INTEGER) DESC")]
    conn.close()
    if not rows:
        log.error("djs.sqlite is empty — refusing to push")
        return 1

    base, key = supabase_env()

    # first_seen must survive re-pushes (brief §6). sqlite also keeps it fixed,
    # but prefer whatever Supabase already recorded on the very first insert.
    existing = {
        d["ra_artist_id"]: d["first_seen"]
        for d in fetch_all(base, key, "djs?select=ra_artist_id,first_seen&order=ra_artist_id.asc")
    }

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    payload = []
    for r in rows:
        rid = clean(r["ra_id"])
        name = clean(r["name"])
        if not rid or not name:            # skip malformed rows
            continue
        payload.append({
            "ra_artist_id":    rid,
            "name":            name,
            "ra_followers":    to_int(r["ra_followers"]),
            "genres":          split_list(r["genres"]),
            "instagram":       clean(r["instagram"]),
            "soundcloud":      clean(r["soundcloud"]),
            "website":         clean(r["website"]),
            "bandcamp":        clean(r["bandcamp"]),
            "discogs":         clean(r["discogs"]),
            "known_venues":    split_list(r["venues_most_played"]),
            "regions":         split_list(r["regions_most_played"]),
            "bcn_events_seen": to_int(r["bcn_event_count"]),
            "ra_url":          clean(r["ra_url"]),
            "image_url":       clean(r["image_url"]),
            "cover_image_url": clean(r["cover_image_url"]),
            "bio":             clean(r["bio"]),
            "first_seen":      existing.get(rid) or clean(r["first_seen"]),
            "last_enriched":   clean(r["last_enriched"]),
            "updated_at":      now_iso,
        })

    log.info("%d DJs in sqlite → %d valid rows, %d already in Supabase",
             len(rows), len(payload), len(existing))

    if dry_run:
        log.info("--dry-run: nothing written. Sample: %s",
                 json.dumps(payload[0], ensure_ascii=False)[:500])
        return 0

    written = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        try:
            request(f"{base}/rest/v1/djs?on_conflict=ra_artist_id", key,
                    method="POST",
                    body=json.dumps(chunk, ensure_ascii=False).encode(),
                    prefer="resolution=merge-duplicates,return=minimal")
        except urllib.error.HTTPError as e:
            log.error("upsert failed at row %d: %s %s", i, e.code, e.read()[:400])
            return 1
        written += len(chunk)

    log.info("pushed %d DJs (%d new)", written, len(payload) - len(existing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
