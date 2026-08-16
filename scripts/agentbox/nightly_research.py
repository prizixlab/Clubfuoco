#!/usr/bin/env python3
"""Nightly Barcelona nightlife research — two phases, Barcelona only (RA areaId 20).

PHASE 1  Event report (robust + exportable):
  - Pull events from Resident Advisor GraphQL.
  - ALWAYS write a structured report: events/<date>.json, events/<date>.csv,
    and a human digest digests/<date>.md — even if a source fails (status noted).

PHASE 2  Promoter intelligence (accumulating):
  - Collect Barcelona promoters (area query + harvested from events).
  - Rank by follower count / upcoming events ("biggest").
  - Enrich each with Instagram + email + website + works_digitally, primarily by
    scraping the promoter's OWN website (no rate limits), falling back to a
    throttled web search only when needed.
  - Upsert into an accumulating SQLite DB and export promoters/promoters.csv.

Phase 2 never runs until Phase 1's report is safely on disk.
Resume-friendly and polite; re-enriches a promoter at most every 14 days.
"""

from __future__ import annotations

import re as _re
import html as _html
import csv
import datetime as dt
import json
import logging
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
INTEL = ROOT / "intel"
EVENTS_DIR = INTEL / "events"
DIGESTS_DIR = INTEL / "digests"
PROM_DIR = INTEL / "promoters"
LOG_PATH = ROOT / "logs" / "nightly_research.log"
for d in (EVENTS_DIR, DIGESTS_DIR, PROM_DIR, LOG_PATH.parent):
    d.mkdir(parents=True, exist_ok=True)

PROM_DB = PROM_DIR / "promoters.sqlite"
PROM_CSV = PROM_DIR / "promoters.csv"

RA_GQL = "https://ra.co/graphql"
BCN_AREA_ID = 20
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.1:8b"

# Per-RUN caps are small because the worker runs many times a day (every ~30
# min). The real safety limit is the shared DAILY BUDGET below, enforced across
# all runs, plus a circuit breaker that pauses IG if it starts getting blocked.
WEBSITE_TIMEOUT = 15
SEARCH_DELAY = 20          # seconds between fallback web searches
MAX_SEARCHES_PER_RUN = 4   # small per-run slice (daily budget is the real limit)
REENRICH_AFTER_DAYS = 14
IG_STATS_DELAY = 25        # slowed from 7s (2026-07-21): the fast pace tripped the
                           # breaker EVERY day for 5 days, costing 6h lockouts each
                           # time and capping real throughput below the budget.
MAX_IG_CHECKS_PER_RUN = 5  # small per-run slice
IG_REFRESH_AFTER_DAYS = 7  # re-check follower counts at most weekly
MAX_IG_DISCOVERY_PER_RUN = 5   # NEW promoters ADDED per run
MAX_IG_DISCOVERY_CHECKS = 6    # candidates CHECKED per run
SEED_HANDLES_FILE = PROM_DIR / "seed_handles.txt"  # always-monitored IG handles

# Shared DAILY budgets (across every run that day). Raised for "faster" mode;
# the circuit breaker backs off automatically if Instagram flags the IP.
IG_DAILY_BUDGET = 220      # rarely the binding limit; the breaker was.
BRAVE_DAILY_BUDGET = 160   # max Brave search calls per calendar day
BRAVE_DISCOVERY_RESERVE = 100  # discovery stops here, leaving the rest for enrichment
IG_BREAKER_STREAK = 6      # tolerate a couple of transient blips before pausing
IG_BREAKER_HOURS = 3       # shorter cool-off; 6h was losing a quarter of each day
_ig_fail_streak = 0        # module-level; reset on success
_LAST_IG_STATUS = "ok"     # ok | ratelimit | account_error | error

# --- Phase 3: club curation (pitches + activate/remove sheets) -------------
SUPABASE_ENV = ROOT / "secrets" / "supabase.env"
CURATION_DIR = INTEL / "curation"
ACTIVATE_CSV = CURATION_DIR / "recommend_activate.csv"
REMOVE_CSV = CURATION_DIR / "recommend_remove.csv"
NOT_NIGHTLIFE_CSV = CURATION_DIR / "not_nightlife.csv"
# PITCH WRITING IS OFF (Yakov, 2026-07-21). The LLM kept mis-typing venues from
# thin data — restaurants, then hotels — and a pitch can never be overwritten, so
# every mistake was permanent. Classification still runs (it feeds the activate
# sheet); nothing is written to Supabase. Set True to re-enable.
PITCH_WRITING_ENABLED = False
MAX_PITCHES_PER_RUN = 4     # only used when PITCH_WRITING_ENABLED
CURATION_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("nightly")

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
IG_RE = re.compile(r"instagram\.com/([A-Za-z0-9._]+)")
IG_BAD = {"p", "reel", "reels", "explore", "tv", "stories", "accounts",
          "about", "developer", "legal", "directory", "web", "instagram",
          # Static-asset / infra paths that appear in embed scripts. `rsrc.php`
          # in particular polluted 14 promoter rows before this was caught.
          "rsrc", "static", "images", "image", "embed", "api", "graphql",
          "oauth", "privacy", "terms", "help", "policies", "sitemap", "share"}


def _valid_ig_handle(h: str | None) -> bool:
    """Reject infra paths and filenames that the URL regex can pick up."""
    if not h:
        return False
    h = h.strip("/").lower()
    if len(h) < 3 or h in IG_BAD or h.isdigit():
        return False
    # real handles never contain a file extension
    if re.search(r"\.(php|js|css|png|jpe?g|gif|svg|ico|json|html?)$", h):
        return False
    return bool(re.fullmatch(r"[a-z0-9._]+", h))
EMAIL_BAD_SUBSTR = ("sentry", "wixpress", "example.", "@sentry", "godaddy",
                    ".png", ".jpg", ".jpeg", ".gif", ".svg")


# ----------------------------------------------------------------------------
# RA GraphQL helpers
# ----------------------------------------------------------------------------

def ra_query(query: str, variables: dict | None = None, timeout: int = 30) -> dict:
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        RA_GQL, data=body,
        headers={"Content-Type": "application/json", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


EVENT_WINDOW_DAYS = 14   # scour up to 2 weeks ahead each night
EVENT_PAGE_SIZE = 100
EVENT_MAX_PAGES = 8      # safety cap (EVENT_PAGE_SIZE * this = max events)
DJS_DB = EVENTS_DIR / "djs.sqlite"             # accumulating DJ/artist profiles
DJS_CSV = EVENTS_DIR / "djs.csv"
MAX_DJ_ENRICH_PER_RUN = 25                     # RA GraphQL, not rate-limited like IG
EVENTS_DB = EVENTS_DIR / "events.sqlite"       # accumulating, dedup-by-id calendar
UPCOMING_CSV = EVENTS_DIR / "upcoming.csv"     # rolling 2-week forward calendar (real events)
SETLISTS_CSV = EVENTS_DIR / "setlists.csv"     # venue format-nights (genres only, no lineup)


def fetch_events() -> list[dict]:
    """ALL Barcelona events in the next EVENT_WINDOW_DAYS, across every venue.

    Uses RA's paginated `eventListings` (what ra.co's own listings page uses) —
    not the `events(type: POPULAR)` slice, which clustered on 2-3 venues.
    Returns [] on failure.
    """
    q = """
    query ($filters: FilterInputDtoInput, $page: Int, $pageSize: Int) {
      eventListings(filters: $filters, pageSize: $pageSize, page: $page,
                    sort: {listingDate: {order: ASCENDING}}) {
        totalResults
        data {
          event {
            id title date startTime endTime contentUrl interestedCount attending cost
            minimumAge lineup
            content
            images { filename type }
            venue { name address capacity area { name } }
            artists { id name }
            genres { name }
            promoters { id name }
          }
        }
      }
    }"""
    today = dt.date.today().isoformat()
    end = (dt.date.today() + dt.timedelta(days=EVENT_WINDOW_DAYS)).isoformat()
    filters = {"areas": {"eq": BCN_AREA_ID},
               "listingDate": {"gte": today, "lte": end}}
    out: dict[str, dict] = {}
    for page in range(1, EVENT_MAX_PAGES + 1):
        try:
            d = ra_query(q, {"filters": filters, "page": page, "pageSize": EVENT_PAGE_SIZE})
            if "errors" in d:
                log.warning("  RA eventListings page %d errors: %s", page, d["errors"][:1])
                break
            el = (d.get("data") or {}).get("eventListings") or {}
            rows = el.get("data") or []
            for it in rows:
                ev = it.get("event") or {}
                if ev.get("id"):
                    out[ev["id"]] = ev
            log.info("  RA eventListings page %d: +%d (total so far %d / %s)",
                     page, len(rows), len(out), el.get("totalResults"))
            if len(rows) < EVENT_PAGE_SIZE:
                break  # last page
        except Exception as e:
            log.warning("  RA eventListings page %d FAILED: %s", page, e)
            break
    return list(out.values())


def fetch_area_promoters(limit: int = 100) -> list[dict]:
    q = """
    query ($areaId: ID!, $limit: Int!) {
      promoters(areaId: $areaId, limit: $limit) {
        id name website facebook twitter followerCount upcomingEventsCount contentUrl
        area { name }
      }
    }"""
    try:
        d = ra_query(q, {"areaId": BCN_AREA_ID, "limit": limit})
        return (d.get("data") or {}).get("promoters") or []
    except Exception as e:
        log.warning("  RA area promoters FAILED: %s", e)
        return []


def fetch_promoter_detail(pid: str) -> dict | None:
    q = """
    query ($id: ID!) {
      promoter(id: $id) {
        id name website facebook twitter instagram email
        followerCount upcomingEventsCount contentUrl area { name }
      }
    }"""
    try:
        d = ra_query(q, {"id": pid})
        return (d.get("data") or {}).get("promoter")
    except Exception as e:
        log.debug("  promoter detail %s failed: %s", pid, e)
        return None


# ----------------------------------------------------------------------------
# PHASE 1 — event report
# ----------------------------------------------------------------------------

def write_event_report(today: dt.date) -> dict:
    log.info("PHASE 1: event report")
    events = fetch_events()
    status = "ok" if events else "NO DATA (RA unreachable or empty)"

    # Structured JSON (always written)
    json_path = EVENTS_DIR / f"{today.isoformat()}.json"
    json_path.write_text(json.dumps(
        {"date": today.isoformat(), "area": "Barcelona", "status": status,
         "event_count": len(events), "events": events},
        ensure_ascii=False, indent=2))

    # Structured CSV (always written, even if header-only)
    csv_path = EVENTS_DIR / f"{today.isoformat()}.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["date", "title", "venue", "area", "promoters", "artists",
                    "interested", "attending", "cost", "ra_url"])
        for e in sorted(events, key=lambda x: x.get("interestedCount") or 0, reverse=True):
            venue = (e.get("venue") or {}).get("name") or ""
            area = ((e.get("venue") or {}).get("area") or {}).get("name") or ""
            proms = " | ".join(p.get("name", "") for p in (e.get("promoters") or []))
            arts = " | ".join(a.get("name", "") for a in (e.get("artists") or []))
            url = "https://ra.co" + (e.get("contentUrl") or "")
            w.writerow([(e.get("date") or "")[:10], e.get("title") or "", venue, area,
                        proms, arts, e.get("interestedCount") or 0,
                        e.get("attending") or 0, e.get("cost") or "", url])

    # Accumulate into the rolling 2-week calendar (dedup by event id across nights).
    try:
        ec = events_db()
        new = upsert_events(ec, events, today)
        n_up = export_upcoming_csv(ec, today)
        ec.close()
        log.info("  upcoming calendar: %d events within %dd (%d newly announced) → upcoming.csv",
                 n_up, EVENT_WINDOW_DAYS, new)
    except Exception as e:
        log.warning("  upcoming-calendar update failed: %s", e)

    # Human digest (LLM if available; plain fallback otherwise). Never fatal.
    md = build_digest_markdown(today, events, status)
    (DIGESTS_DIR / f"{today.isoformat()}.md").write_text(md)

    log.info("PHASE 1 done: %d events, status=%s", len(events), status)
    return {"events": events, "status": status}


def events_db() -> sqlite3.Connection:
    c = sqlite3.connect(EVENTS_DB)
    c.execute("""CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, title TEXT, date TEXT, start_time TEXT,
        venue TEXT, area TEXT, promoters TEXT, artists TEXT,
        interested INTEGER, attending INTEGER, cost TEXT, ra_url TEXT,
        first_seen TEXT, last_seen TEXT)""")
    existing = {r[1] for r in c.execute("PRAGMA table_info(events)")}
    for col, typ in (("genres", "TEXT"), ("kind", "TEXT"),
                     ("image", "TEXT"), ("description", "TEXT"),
                     ("end_time", "TEXT"), ("minimum_age", "INTEGER"),
                     ("venue_capacity", "TEXT"), ("lineup", "TEXT")):
        if col not in existing:
            c.execute(f"ALTER TABLE events ADD COLUMN {col} {typ}")
    c.commit()
    return c


_LINEUP_RE = re.compile(r'<artist id="(\d+)"[^>]*>(.*?)</artist>', re.S | re.I)


def _lineup(raw: str | None) -> str | None:
    """RA's `lineup` as ordered [{id, name}] JSON.

    The field is markup, not prose:
        <artist id="72992">Silverlining</artist>
    which is worth more than the `artists` array we already store, on two
    counts: it preserves BILLING ORDER, and it carries RA's artist id per
    credit. The app currently joins a credit to a DJ page by NAME — the same
    fragile join that made venue linking painful — and an id makes it exact.

    Returns None when RA gave us no markup, so COALESCE keeps any earlier value
    rather than blanking it on a bad night.
    """
    if not raw:
        return None
    out = []
    for aid, name in _LINEUP_RE.findall(raw):
        name = re.sub(r"<[^>]+>", "", name).strip()
        if name:
            out.append({"id": aid, "name": name})
    return json.dumps(out, ensure_ascii=False) if out else None


def _event_kind(artists: str) -> str:
    """'event' = a curated lineup of named DJs/artists; 'setlist' = a venue's
    recurring format night (RA lists only genres, no named artists — e.g. a
    'reggaeton / hip hop / commercial' Friday). These are NOT real events."""
    return "event" if (artists or "").strip() else "setlist"


def _flyer_url(e: dict) -> str | None:
    """Front flyer for an event, else any image RA gave us.

    images[].filename is already an absolute https URL on this feed; older RA
    payloads carry a bare filename, so those are still expanded against the
    flyer CDN rather than stored as a broken relative path.
    """
    imgs = e.get("images") or []
    pick = (next((i for i in imgs if (i.get("type") or "").upper() == "FLYERFRONT"), None)
            or next((i for i in imgs if i.get("filename")), None))
    name = (pick or {}).get("filename")
    if not name:
        return None
    return name if name.startswith("http") else \
        "https://static.ra.co/images/events/flyers/" + name


def _clean_content(raw: str | None) -> str | None:
    """RA event copy as plain text: strip any markup, collapse the runs of blank
    lines promoters leave behind, and cap the length — this is a blurb on a
    card, not an article. None when the event has no copy."""
    if not raw:
        return None
    text = _re.sub(r"<[^>]+>", " ", raw)
    text = _html.unescape(text)
    text = _re.sub(r"[ \t]+", " ", text)
    text = _re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip()
    if len(text) > 1200:
        text = text[:1200].rsplit(" ", 1)[0] + "\u2026"
    return text or None


def upsert_events(c: sqlite3.Connection, events: list[dict], today: dt.date) -> int:
    """Upsert events keyed by RA id (no duplicates across nights). Returns #new."""
    now = today.isoformat()
    new = 0
    for e in events:
        eid = e.get("id")
        if not eid:
            continue
        venue = (e.get("venue") or {}).get("name") or ""
        area = ((e.get("venue") or {}).get("area") or {}).get("name") or ""
        proms = " | ".join(p.get("name", "") for p in (e.get("promoters") or []))
        arts = " | ".join(a.get("name", "") for a in (e.get("artists") or []))
        genres = " | ".join(g.get("name", "") for g in (e.get("genres") or []))
        kind = _event_kind(arts)
        url = "https://ra.co" + (e.get("contentUrl") or "")
        image = _flyer_url(e)
        description = _clean_content(e.get("content"))
        lineup = _lineup(e.get("lineup"))
        capacity = ((e.get("venue") or {}).get("capacity") or "").strip() or None
        vals = (e.get("title"), (e.get("date") or "")[:10], e.get("startTime"),
                venue, area, proms, arts, e.get("interestedCount") or 0,
                e.get("attending") or 0, e.get("cost") or "", url, genres, kind,
                image, description, e.get("endTime"), e.get("minimumAge"),
                capacity, lineup)
        if c.execute("SELECT 1 FROM events WHERE id=?", (eid,)).fetchone():
            c.execute("""UPDATE events SET title=?,date=?,start_time=?,venue=?,area=?,
                        promoters=?,artists=?,interested=?,attending=?,cost=?,ra_url=?,
                        genres=?,kind=?,image=COALESCE(?,image),
                        description=COALESCE(?,description),
                        end_time=COALESCE(?,end_time),
                        minimum_age=COALESCE(?,minimum_age),
                        venue_capacity=COALESCE(?,venue_capacity),
                        lineup=COALESCE(?,lineup),
                        last_seen=? WHERE id=?""", (*vals, now, eid))
        else:
            c.execute("""INSERT INTO events
                        (id,title,date,start_time,venue,area,promoters,artists,
                         interested,attending,cost,ra_url,genres,kind,image,description,
                         end_time,minimum_age,venue_capacity,lineup,
                         first_seen,last_seen)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (eid, *vals, now, now))
            new += 1
    c.commit()
    return new


def _write_events_csv(path, rows) -> int:
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["ra_event_id", "date", "start_time", "title", "venue", "area",
                    "promoters", "artists", "genres", "kind", "interested",
                    "attending", "cost", "ra_url", "first_seen", "last_seen"])
        w.writerows(rows)
    return len(rows)


def export_upcoming_csv(c: sqlite3.Connection, today: dt.date) -> int:
    """Split the rolling calendar into real EVENTS vs format-night SET LISTS.

    upcoming.csv = curated events (named lineup). setlists.csv = venue format
    nights (genres only, no named artists). Both deduped, soonest first.
    Returns the count of real events.
    """
    cols = """id, date, start_time, title, venue, area, promoters, artists,
              genres, kind, interested, attending, cost, ra_url, first_seen, last_seen"""
    events = c.execute(f"""SELECT {cols} FROM events
                          WHERE date >= ? AND COALESCE(kind,'event')='event'
                          ORDER BY date, venue, title""", (today.isoformat(),)).fetchall()
    setlists = c.execute(f"""SELECT {cols} FROM events
                            WHERE date >= ? AND kind='setlist'
                            ORDER BY date, venue, title""", (today.isoformat(),)).fetchall()
    _write_events_csv(UPCOMING_CSV, events)
    _write_events_csv(SETLISTS_CSV, setlists)
    log.info("  events=%d setlists=%d", len(events), len(setlists))
    return len(events)


def build_digest_markdown(today: dt.date, events: list[dict], status: str) -> str:
    header = f"# Barcelona Nightlife Intel — {today.strftime('%a %b %d, %Y')}\n\n"
    if not events:
        return header + f"_Status: {status}. No events retrieved today._\n"

    def fmt(e):
        venue = (e.get("venue") or {}).get("name") or "?"
        arts = ", ".join(a.get("name", "") for a in (e.get("artists") or [])[:5])
        return (f"- **{e.get('title','?')}** @ {venue} ({(e.get('date') or '')[:10]}) "
                f"— {arts or 'n/a'} · {e.get('interestedCount') or 0} interested")

    top = sorted(events, key=lambda x: x.get("interestedCount") or 0, reverse=True)
    data_block = "\n".join(fmt(e) for e in top[:25])

    prompt = (f"You are the editorial AI for Club Fuoco. Today is {today.isoformat()}. "
              f"From these Barcelona events, write a punchy Markdown digest with sections "
              f"## What's hot this week (5-7 picks, one line each) and ## Editorial picks "
              f"(3 you'd recommend). Be concrete, mention real artists/venues. "
              f"Spanish names stay Spanish. Output only Markdown, no preamble.\n\n{data_block}")
    try:
        llm = ollama_generate(prompt, max_tokens=1400)
        if llm and len(llm) > 120:
            return header + llm.strip() + f"\n\n---\n_Events: {len(events)} · status: {status}_\n"
    except Exception as e:
        log.warning("  LLM digest failed, using plain fallback: %s", e)

    # Plain fallback — guarantees a readable report no matter what
    return (header + "## What's hot this week\n" + "\n".join(fmt(e) for e in top[:10])
            + f"\n\n---\n_Plain report (LLM unavailable). Events: {len(events)} · status: {status}_\n")


def ollama_generate(prompt: str, max_tokens: int = 1400) -> str:
    body = json.dumps({
        "model": MODEL, "prompt": prompt, "stream": True,
        "options": {"num_ctx": 8192, "num_predict": max_tokens, "temperature": 0.5},
    }).encode()
    req = urllib.request.Request(OLLAMA_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    chunks = []
    with urllib.request.urlopen(req, timeout=None) as r:
        for line in r:
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("response"):
                chunks.append(o["response"])
            if o.get("done"):
                break
    return "".join(chunks)


# ----------------------------------------------------------------------------
# PHASE 2 — promoter intelligence
# ----------------------------------------------------------------------------

def db() -> sqlite3.Connection:
    c = sqlite3.connect(PROM_DB)
    c.execute("""CREATE TABLE IF NOT EXISTS promoters (
        ra_id TEXT PRIMARY KEY,
        name TEXT,
        area TEXT,
        follower_count INTEGER,
        upcoming_events INTEGER,
        website TEXT,
        instagram TEXT,
        email TEXT,
        facebook TEXT,
        twitter TEXT,
        ra_url TEXT,
        works_digitally INTEGER,
        first_seen TEXT,
        last_ra_update TEXT,
        last_enriched TEXT,
        ig_followers INTEGER,
        ig_following INTEGER,
        ig_ratio REAL,
        ig_last_checked TEXT,
        source TEXT,
        ig_bio TEXT,
        ig_external_url TEXT,
        ig_category TEXT
    )""")
    # Candidates already examined by discovery (so nightly runs explore new ones).
    c.execute("""CREATE TABLE IF NOT EXISTS ig_checked (
        handle TEXT PRIMARY KEY,
        last_checked TEXT,
        was_added INTEGER
    )""")
    # Shared per-day API budget + IG circuit breaker (across all runs that day).
    c.execute("""CREATE TABLE IF NOT EXISTS rate (
        day TEXT PRIMARY KEY,
        ig INTEGER DEFAULT 0,
        brave INTEGER DEFAULT 0,
        ig_blocked_until TEXT
    )""")
    # Migrate older DBs: add columns if missing.
    existing = {r[1] for r in c.execute("PRAGMA table_info(promoters)")}
    for col, typ in (("ig_followers", "INTEGER"), ("ig_following", "INTEGER"),
                     ("ig_ratio", "REAL"), ("ig_last_checked", "TEXT"),
                     ("source", "TEXT"), ("ig_bio", "TEXT"),
                     ("ig_external_url", "TEXT"), ("ig_category", "TEXT"),
                     ("clubs", "TEXT"), ("offer_free_guestlist", "INTEGER"),
                     ("offer_vip", "INTEGER"), ("vip_price", "TEXT"),
                     ("offers_checked", "TEXT"), ("ig_attempts", "INTEGER")):
        if col not in existing:
            c.execute(f"ALTER TABLE promoters ADD COLUMN {col} {typ}")
    c.commit()
    return c


def upsert_ig_promoter(c: sqlite3.Connection, handle: str, source: str,
                       today: str, profile: dict | None = None) -> None:
    """Insert/refresh an Instagram-native promoter (no RA id) keyed by ig:<handle>."""
    key = f"ig:{handle}"
    row = c.execute("SELECT ra_id FROM promoters WHERE ra_id=? OR instagram=?",
                    (key, handle)).fetchone()
    ig_url = f"https://instagram.com/{handle}"
    if row:
        c.execute("UPDATE promoters SET instagram=COALESCE(instagram,?), area='Barcelona', "
                  "source=COALESCE(source,?) WHERE ra_id=?", (handle, source, row[0]))
    else:
        c.execute("""INSERT INTO promoters (ra_id,name,area,instagram,ra_url,
                    works_digitally,first_seen,source)
                    VALUES (?,?,?,?,?,?,?,?)""",
                  (key, handle, "Barcelona", handle, ig_url, 1, today, source))
    c.commit()


def fetch_ig_profile(handle: str) -> dict | None:
    """Return a public IG profile dict, or None.

    Uses curl (subprocess), not requests: Instagram fingerprints Python's TLS
    signature and returns 429, whereas curl's passes with 200.
    Keys: followers, following, bio, external_url, category, full_name, related[].
    """
    if not handle:
        return None
    ig_ua = ("Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) "
             "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 "
             "Mobile/15E148 Safari/604.1")
    url = ("https://i.instagram.com/api/v1/users/web_profile_info/"
           f"?username={urllib.parse.quote(handle)}")
    try:
        import subprocess
        r = subprocess.run(
            ["curl", "-s", "--max-time", str(WEBSITE_TIMEOUT),
             "-H", f"User-Agent: {ig_ua}",
             "-H", "x-ig-app-id: 936619743392459", url],
            capture_output=True, text=True, timeout=WEBSITE_TIMEOUT + 5,
        )
        global _LAST_IG_STATUS
        if not r.stdout.strip():
            _LAST_IG_STATUS = "ratelimit"      # empty body = throttled
            return None
        payload = json.loads(r.stdout)
        if payload.get("status") == "fail":
            msg = (payload.get("message") or "").lower()
            if payload.get("require_login") or "wait a few minutes" in msg:
                _LAST_IG_STATUS = "ratelimit"  # genuine IP throttle
            else:
                # e.g. "Asset asset://laser.provider/... has been deleted" —
                # an Instagram-side schema bug on certain business accounts.
                # Permanent for that handle, and NOT a sign we're blocked, so it
                # must not count toward the circuit breaker.
                _LAST_IG_STATUS = "account_error"
            return None
        u = (payload.get("data") or {}).get("user") or {}
        followers = (u.get("edge_followed_by") or {}).get("count")
        following = (u.get("edge_follow") or {}).get("count")
        if followers is None or following is None:
            return None
        related = [e["node"]["username"]
                   for e in (u.get("edge_related_profiles") or {}).get("edges", [])
                   if e.get("node", {}).get("username")]
        _LAST_IG_STATUS = "ok"
        return {
            "followers": int(followers),
            "following": int(following),
            "bio": u.get("biography") or "",
            "external_url": u.get("external_url") or "",
            "category": u.get("category_name") or "",
            "full_name": u.get("full_name") or "",
            "related": related,
        }
    except Exception as e:
        _LAST_IG_STATUS = "error"
        log.debug("  IG profile %s failed: %s", handle, e)
        return None


# --- Shared daily API budget + IG circuit breaker -------------------------

def _rate_today(c: sqlite3.Connection) -> tuple[int, int, str | None]:
    day = dt.date.today().isoformat()
    c.execute("INSERT OR IGNORE INTO rate(day, ig, brave) VALUES (?,0,0)", (day,))
    c.commit()
    return c.execute("SELECT ig, brave, ig_blocked_until FROM rate WHERE day=?",
                     (day,)).fetchone()


def ig_budget_ok(c: sqlite3.Connection) -> bool:
    ig, _brave, blocked = _rate_today(c)
    if blocked and blocked > dt.datetime.utcnow().isoformat():
        return False
    return ig < IG_DAILY_BUDGET


def brave_budget_ok(c: sqlite3.Connection, reserve: int = 0) -> bool:
    """`reserve` keeps headroom for higher-priority work later in the run.

    Discovery runs before enrichment, and was consuming the entire daily Brave
    budget (120/120 every day), starving the handle-lookups for promoters we
    already track. Discovery now passes a reserve so enrichment always gets a share.
    """
    _ig, brave, _b = _rate_today(c)
    return brave < (BRAVE_DAILY_BUDGET - reserve)


def _note_brave(c: sqlite3.Connection) -> None:
    c.execute("UPDATE rate SET brave=brave+1 WHERE day=?", (dt.date.today().isoformat(),))
    c.commit()


def guarded_ig_profile(c: sqlite3.Connection, handle: str) -> dict | None:
    """IG fetch that spends the daily budget and trips a breaker on failure runs.

    Caller must have already confirmed ig_budget_ok(c). Counts the call, and if
    Instagram starts returning nothing IG_BREAKER_STREAK times in a row, pauses
    all IG calls for IG_BREAKER_HOURS so we don't dig a deeper ban.
    """
    global _ig_fail_streak
    day = dt.date.today().isoformat()
    c.execute("UPDATE rate SET ig=ig+1 WHERE day=?", (day,))
    c.commit()
    prof = fetch_ig_profile(handle)
    if prof is None and _LAST_IG_STATUS == "account_error":
        # Instagram's own bug on this handle — not a throttle. Don't let it
        # trip the breaker (that was pausing us for hours while the IP was fine).
        return None
    if prof is None:
        _ig_fail_streak += 1
        if _ig_fail_streak >= IG_BREAKER_STREAK:
            until = (dt.datetime.utcnow() + dt.timedelta(hours=IG_BREAKER_HOURS)).isoformat()
            c.execute("UPDATE rate SET ig_blocked_until=? WHERE day=?", (until, day))
            c.commit()
            log.warning("  IG circuit breaker TRIPPED (%d fails) — paused until %s",
                        _ig_fail_streak, until)
    else:
        _ig_fail_streak = 0
    return prof


# Bio must show BOTH a Barcelona signal AND a nightlife/promoter signal.
_BCN_SIGNALS = ("barcelona", "bcn", "bcn.", "08001", "catalun", "catalon")
_NIGHT_SIGNALS = ("nightlife", "guestlist", "guest list", "guest-list", "lista",
                  "vip table", "vip tables", "mesa", "reservas", "reserva",
                  "promoter", "promotor", "club", "clubbing", "discoteca",
                  "free entry", "entrada", "rumba", "party", "fiesta", "nightclub",
                  "opium", "pacha", "sutton", "shoko", "razzmatazz")


def is_bcn_nightlife(profile: dict, min_followers: int = 3000) -> bool:
    """Heuristic: does this IG profile look like a Barcelona nightlife promoter?"""
    if not profile or profile.get("followers", 0) < min_followers:
        return False
    text = (profile.get("bio", "") + " " + profile.get("full_name", "") + " "
            + profile.get("external_url", "")).lower()
    return any(b in text for b in _BCN_SIGNALS) and any(n in text for n in _NIGHT_SIGNALS)


def load_seed_handles() -> list[str]:
    """Handles to always monitor (one per line; # comments allowed)."""
    if not SEED_HANDLES_FILE.exists():
        return []
    out = []
    for line in SEED_HANDLES_FILE.read_text().splitlines():
        h = line.strip().lstrip("@").split("#")[0].strip().lower()
        if h:
            out.append(h)
    return list(dict.fromkeys(out))


# --- Club agreements + guestlist/VIP offer extraction ---------------------

# Famous Barcelona nightclubs with common spellings/aliases → canonical name.
CURATED_CLUBS = {
    "Opium": ["opium"], "Pacha": ["pacha"], "Shoko": ["shoko"],
    "Sutton": ["sutton"], "Bling Bling": ["bling bling", "blingbling"],
    "Jamboree": ["jamboree"], "Razzmatazz": ["razzmatazz", "razmatazz"],
    "La Fira": ["la fira"], "Downtown": ["downtown"],
    "Otto Zutz": ["otto zutz", "ottozutz"], "CDLC": ["cdlc", "carpe diem"],
    "La Biblioteca": ["la biblioteca", "la biblio"], "Twenties": ["twenties"],
    "Gspot": ["gspot", "g-spot", "g spot"], "Negro y Rojo": ["negro y rojo"],
    "Duvet": ["duvet"], "Catwalk": ["catwalk"], "Boulevard": ["boulevard"],
    "City Hall": ["city hall"], "Luz de Gas": ["luz de gas"],
    "Nitsa": ["nitsa"], "Apolo": ["sala apolo"], "Moog": ["moog club"],
    "Ku Barcelona": ["ku barcelona"], "Costa Breeze": ["costa breeze"],
    "Input": ["input high fidelity", "input club"],
}
_FREE_GL_KW = ("free entry", "free guest", "guestlist", "guest list", "guest-list",
               "free before", "entrada gratis", "lista gratis", "free access",
               "free list", "free club entry")
_VIP_KW = ("vip table", "vip tables", "bottle service", "table service", "bottle",
           "botella", "reservado", "reservados", "vip")
_PRICE_RE = re.compile(
    r"(?:€\s?\d{2,4}(?:[.,]\d{2})?|\d{2,4}\s?€|\d{2,4}\s?eur|\bfrom\s?\d{2,4}\b|"
    r"\bdesde\s?\d{2,4}\b|min(?:imum)?\.?\s?spend[^.\n]{0,25}?\d{2,4}|"
    r"\d{2,4}\s?(?:per person|pp|pax|/pax|per pax))", re.I)


def _norm_txt(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s.lower())


def build_club_index() -> list[tuple[str, str]]:
    """(normalized_alias, canonical_name) pairs for the famous BCN nightclubs.

    Curated list only — high precision. The 358-venue DB list (mostly bars/
    restaurants) added false matches and duplicate spellings, so it's excluded.
    Expand CURATED_CLUBS to broaden coverage.
    """
    idx: list[tuple[str, str]] = []
    for canon, aliases in CURATED_CLUBS.items():
        for a in aliases:
            idx.append((_norm_txt(a), canon))
    idx.sort(key=lambda x: len(x[0]), reverse=True)
    return idx


def analyze_offers(texts: list[str], club_index: list[tuple[str, str]]) -> dict:
    """From combined promoter text, extract clubs + free-guestlist/VIP + any price."""
    norm = _norm_txt(" ".join(t for t in texts if t))
    padded = f" {norm} "
    clubs: list[str] = []
    for alias, canon in club_index:
        if not alias:
            continue
        if re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", norm):
            if canon not in clubs:
                clubs.append(canon)
    free_gl = 1 if any(k in norm for k in _FREE_GL_KW) else 0
    vip = 1 if any(
        (re.search(r"(?<![a-z])vip(?![a-z])", norm) if k == "vip" else k in norm)
        for k in _VIP_KW
    ) else 0
    # Price only makes sense when VIP is offered; reject year-like numbers.
    price = None
    if vip:
        for m in _PRICE_RE.finditer(norm):
            snippet = m.group(0).strip()
            has_cur = ("€" in snippet or "eur" in snippet)
            nums = [int(n) for n in re.findall(r"\d{2,4}", snippet)]
            if not has_cur and any(1900 <= n <= 2099 for n in nums):
                continue  # looks like a year, not a price
            price = snippet
            break
        if not price:
            price = "on request"
    return {"clubs": clubs, "free_guestlist": free_gl, "vip": vip, "vip_price": price}


def fetch_visible_text(url: str) -> str:
    """Best-effort visible text of a promoter page (website or link-in-bio)."""
    if not url:
        return ""
    if not url.startswith("http"):
        url = "https://" + url
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=WEBSITE_TIMEOUT)
        if r.status_code != 200 or not r.text:
            return ""
        soup = BeautifulSoup(r.text, "lxml")
        for t in soup(["script", "style", "noscript"]):
            t.decompose()
        return re.sub(r"\s+", " ", soup.get_text(" "))[:8000]
    except Exception:
        return ""


def scrape_site_for_contacts(url: str) -> tuple[str | None, str | None]:
    """Return (instagram_handle, email) found on the promoter's own website."""
    if not url:
        return None, None
    if not url.startswith("http"):
        url = "https://" + url
    pages = [url]
    ig = email = None
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=WEBSITE_TIMEOUT)
        if r.status_code == 200 and r.text:
            html = r.text
            ig, email = extract_contacts(html)
            # If missing, try a contact-ish subpage
            if not (ig and email):
                for link in contact_links(html, url)[:2]:
                    try:
                        rr = requests.get(link, headers={"User-Agent": UA}, timeout=WEBSITE_TIMEOUT)
                        if rr.status_code == 200:
                            ig2, em2 = extract_contacts(rr.text)
                            ig = ig or ig2
                            email = email or em2
                    except Exception:
                        pass
                    if ig and email:
                        break
    except Exception as e:
        log.debug("  site scrape failed %s: %s", url, e)
    return ig, email


def extract_contacts(html: str) -> tuple[str | None, str | None]:
    ig = None
    for m in IG_RE.finditer(html):
        handle = m.group(1).strip("/").lower()
        if _valid_ig_handle(handle):
            ig = handle
            break
    email = None
    for m in EMAIL_RE.finditer(html):
        e = m.group(0)
        if not any(b in e.lower() for b in EMAIL_BAD_SUBSTR):
            email = e
            break
    return ig, email


def contact_links(html: str, base: str) -> list[str]:
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        return []
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        txt = (a.get_text() or "").lower()
        if any(k in href.lower() or k in txt for k in ("contact", "contacto", "about", "info")):
            out.append(urllib.parse.urljoin(base, href))
    return list(dict.fromkeys(out))


def brave_find_instagram(name: str) -> str | None:
    try:
        r = requests.get("https://search.brave.com/search",
                         params={"q": f"{name} Barcelona instagram"},
                         headers={"User-Agent": UA}, timeout=WEBSITE_TIMEOUT)
        if r.status_code != 200:
            return None
        for m in IG_RE.finditer(r.text):
            h = m.group(1).strip("/").lower()
            if _valid_ig_handle(h):
                return h
    except Exception as e:
        log.debug("  brave IG search failed for %s: %s", name, e)
    return None


# ----------------------------------------------------------------------------
# DJ / artist profiles (harvested from events, enriched from RA — no IG scraping)
# ----------------------------------------------------------------------------

def djs_db() -> sqlite3.Connection:
    c = sqlite3.connect(DJS_DB)
    c.execute("""CREATE TABLE IF NOT EXISTS djs (
        ra_id TEXT PRIMARY KEY,
        name TEXT,
        instagram TEXT,
        soundcloud TEXT,
        bandcamp TEXT,
        website TEXT,
        discogs TEXT,
        ra_followers INTEGER,
        genres TEXT,               -- derived from the events they play
        venues_most_played TEXT,
        regions_most_played TEXT,
        bio TEXT,
        ra_url TEXT,
        bcn_event_count INTEGER DEFAULT 0,
        first_seen TEXT,
        last_enriched TEXT)""")
    existing = {r[1] for r in c.execute("PRAGMA table_info(djs)")}
    for col, typ in (("source", "TEXT"), ("related_crawled", "TEXT"),
                     ("image_url", "TEXT"), ("cover_image_url", "TEXT")):
        if col not in existing:
            c.execute(f"ALTER TABLE djs ADD COLUMN {col} {typ}")
    # candidates examined by related-artist discovery, so runs explore new ones
    c.execute("""CREATE TABLE IF NOT EXISTS dj_checked (
        ra_id TEXT PRIMARY KEY, last_checked TEXT, added INTEGER)""")
    c.commit()
    return c


def _artist_detail(aid: str) -> dict | None:
    q = """query ($id: ID!) {
        artist(id: $id) {
            name instagram soundcloud bandcamp website discogs
            followerCount contentUrl image coverImage
            venuesMostPlayed { name } regionsMostPlayed { name }
            relatedArtists { id name }
        }
    }"""
    try:
        return (ra_query(q, {"id": aid}).get("data") or {}).get("artist")
    except Exception as ex:
        log.debug("  artist detail %s failed: %s", aid, ex)
        return None


def _store_artist(c: sqlite3.Connection, aid: str, a: dict, today: dt.date,
                  source: str) -> None:
    venues = " | ".join(v["name"] for v in (a.get("venuesMostPlayed") or []) if v.get("name"))
    regions = " | ".join(r["name"] for r in (a.get("regionsMostPlayed") or []) if r.get("name"))
    ra_url = "https://ra.co" + (a.get("contentUrl") or f"/dj/{aid}")
    now = today.isoformat()
    if c.execute("SELECT 1 FROM djs WHERE ra_id=?", (aid,)).fetchone():
        c.execute("""UPDATE djs SET name=COALESCE(?,name), instagram=?, soundcloud=?,
                    bandcamp=?, website=?, discogs=?, ra_followers=?,
                    venues_most_played=?, regions_most_played=?, ra_url=?,
                    image_url=?, cover_image_url=?,
                    last_enriched=? WHERE ra_id=?""",
                  (a.get("name"), a.get("instagram"), a.get("soundcloud"),
                   a.get("bandcamp"), a.get("website"), a.get("discogs"),
                   a.get("followerCount") or 0, venues, regions, ra_url,
                   a.get("image"), a.get("coverImage"), now, aid))
    else:
        c.execute("""INSERT INTO djs (ra_id,name,instagram,soundcloud,bandcamp,website,
                    discogs,ra_followers,venues_most_played,regions_most_played,ra_url,
                    image_url,cover_image_url,genres,bcn_event_count,source,
                    first_seen,last_enriched)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (aid, a.get("name"), a.get("instagram"), a.get("soundcloud"),
                   a.get("bandcamp"), a.get("website"), a.get("discogs"),
                   a.get("followerCount") or 0, venues, regions, ra_url,
                   a.get("image"), a.get("coverImage"), "", 0, source, now, now))
    c.commit()


def _is_barcelona_dj(a: dict | None, top_n: int = 3) -> bool:
    """Contained to Barcelona: Barcelona must be one of the DJ's TOP regions
    (regionsMostPlayed is ordered most-played first), not merely appear somewhere
    in a globe-trotting DJ's list."""
    if not a:
        return False
    regions = [r.get("name") for r in (a.get("regionsMostPlayed") or [])]
    return "Barcelona" in regions[:top_n]


def discover_related_djs(c: sqlite3.Connection, today: dt.date,
                         seed_limit: int = 6, max_add: int = 15,
                         max_check: int = 40, hard: bool = False) -> int:
    """Grow the DJ list via RA relatedArtists, kept Barcelona-contained.
    `hard`=True is the weekly deep sweep once the light crawl has plateaued:
    many more seeds, and it re-examines candidates previously rejected (they may
    have started playing Barcelona since). Returns #added."""
    now = today.isoformat()
    if hard:
        seed_limit, max_add, max_check = 30, 40, 150
        # forget old rejections so the deep sweep re-considers them
        c.execute("DELETE FROM dj_checked WHERE added=0")
        c.commit()
    recent = {r[0] for r in c.execute(
        "SELECT ra_id FROM dj_checked WHERE last_checked > ?",
        ((today - dt.timedelta(days=60)).isoformat(),))}
    known = {r[0] for r in c.execute("SELECT ra_id FROM djs")}
    seeds = c.execute("""SELECT ra_id FROM djs WHERE ra_followers IS NOT NULL
                         ORDER BY related_crawled IS NOT NULL, ra_followers DESC
                         LIMIT ?""", (seed_limit,)).fetchall()
    candidates: list[str] = []
    for (sid,) in seeds:
        a = _artist_detail(sid)
        c.execute("UPDATE djs SET related_crawled=? WHERE ra_id=?", (now, sid))
        c.commit()
        if not a:
            continue
        for r in (a.get("relatedArtists") or []):
            rid = r.get("id")
            if rid and rid not in known and rid not in recent and rid not in candidates:
                candidates.append(rid)

    added = checked = 0
    for cid in candidates:
        if added >= max_add or checked >= max_check:
            break
        checked += 1
        a = _artist_detail(cid)
        is_bcn = _is_barcelona_dj(a)
        c.execute("INSERT OR REPLACE INTO dj_checked VALUES (?,?,?)",
                  (cid, now, 1 if is_bcn else 0))
        c.commit()
        if is_bcn:
            _store_artist(c, cid, a, today, source="related")
            added += 1
    if added or hard:
        log.info("  DJ discovery%s: +%d Barcelona DJs (checked %d)",
                 " [HARD weekly sweep]" if hard else "", added, checked)
    return added


def run_dj_discovery(c: sqlite3.Connection, today: dt.date) -> int:
    """Discover DJs every run WHILE it's still productive. Once the light crawl
    stops finding matches (plateau), back off to a hard deep-sweep once a week."""
    c.execute("""CREATE TABLE IF NOT EXISTS dj_discovery_state (
        id INTEGER PRIMARY KEY CHECK (id=1),
        empty_streak INTEGER DEFAULT 0, last_hard TEXT)""")
    c.execute("INSERT OR IGNORE INTO dj_discovery_state (id,empty_streak) VALUES (1,0)")
    c.commit()
    streak, last_hard = c.execute(
        "SELECT empty_streak, last_hard FROM dj_discovery_state WHERE id=1").fetchone()

    PLATEAU_AT = 4          # empty light-crawl runs in a row => plateaued
    HARD_EVERY_DAYS = 7

    if streak < PLATEAU_AT:
        added = discover_related_djs(c, today)                       # normal crawl
        streak = 0 if added > 0 else streak + 1
        c.execute("UPDATE dj_discovery_state SET empty_streak=? WHERE id=1", (streak,))
        c.commit()
        return added

    # Plateaued — only do the expensive deep sweep about once a week.
    due = (last_hard is None or
           last_hard < (today - dt.timedelta(days=HARD_EVERY_DAYS)).isoformat())
    if not due:
        return 0
    added = discover_related_djs(c, today, hard=True)
    # if the sweep found new blood, resume the frequent light crawl
    c.execute("UPDATE dj_discovery_state SET empty_streak=?, last_hard=? WHERE id=1",
              (0 if added > 0 else PLATEAU_AT, today.isoformat()))
    c.commit()
    return added


def harvest_past_djs(c: sqlite3.Connection, today: dt.date, days: int = 60) -> int:
    """Backfill DJs from PAST Barcelona events (last `days`), so the list isn't
    limited to who happens to be booked in the next two weeks."""
    q = """query ($filters: FilterInputDtoInput, $page: Int, $pageSize: Int) {
        eventListings(filters: $filters, pageSize: $pageSize, page: $page,
                      sort: {listingDate: {order: DESCENDING}}) {
            data { event { artists { id name } genres { name } } }
        }
    }"""
    start = (today - dt.timedelta(days=days)).isoformat()
    end = (today - dt.timedelta(days=1)).isoformat()
    filters = {"areas": {"eq": BCN_AREA_ID}, "listingDate": {"gte": start, "lte": end}}
    new = 0
    for page in range(1, 6):
        try:
            d = ra_query(q, {"filters": filters, "page": page, "pageSize": 100})
            rows = ((d.get("data") or {}).get("eventListings") or {}).get("data") or []
        except Exception as ex:
            log.debug("  past-events page %d failed: %s", page, ex)
            break
        if not rows:
            break
        evs = [it.get("event") or {} for it in rows]
        new += harvest_djs(c, evs, today)
        if len(rows) < 100:
            break
    return new


def harvest_djs(c: sqlite3.Connection, events: list[dict], today: dt.date) -> int:
    """From tonight's events, upsert each named artist and accumulate the genres
    of the events they appear on. Returns count of newly-seen DJs."""
    now = today.isoformat()
    new = 0
    for e in events:
        ev_genres = {g.get("name") for g in (e.get("genres") or []) if g.get("name")}
        for a in (e.get("artists") or []):
            aid, name = a.get("id"), a.get("name")
            if not aid or not name:
                continue
            row = c.execute("SELECT genres, bcn_event_count FROM djs WHERE ra_id=?",
                            (aid,)).fetchone()
            if row:
                have = set((row[0] or "").split(" | ")) - {""}
                merged = " | ".join(sorted(have | ev_genres))
                c.execute("UPDATE djs SET name=?, genres=?, bcn_event_count=? WHERE ra_id=?",
                          (name, merged, (row[1] or 0) + 1, aid))
            else:
                c.execute("""INSERT INTO djs (ra_id,name,genres,bcn_event_count,first_seen)
                             VALUES (?,?,?,?,?)""",
                          (aid, name, " | ".join(sorted(ev_genres)), 1, now))
                new += 1
    c.commit()
    return new


def enrich_djs(c: sqlite3.Connection, today: dt.date, limit: int = MAX_DJ_ENRICH_PER_RUN) -> int:
    """Fill social links / RA followers / venues from RA. Biggest-by-event-count
    first; re-enrich at most every 14 days. Returns count enriched this run."""
    cutoff = (today - dt.timedelta(days=14)).isoformat()
    todo = c.execute("""SELECT ra_id FROM djs
                        WHERE last_enriched IS NULL OR last_enriched < ?
                        ORDER BY bcn_event_count DESC LIMIT ?""",
                     (cutoff, limit)).fetchall()
    q = """query ($id: ID!) {
        artist(id: $id) {
            name instagram soundcloud bandcamp website discogs
            followerCount contentUrl image coverImage
            venuesMostPlayed { name } regionsMostPlayed { name }
        }
    }"""
    done = 0
    for (aid,) in todo:
        try:
            d = ra_query(q, {"id": aid})
            a = (d.get("data") or {}).get("artist")
        except Exception as ex:
            log.debug("  DJ enrich %s failed: %s", aid, ex)
            a = None
        if not a:
            c.execute("UPDATE djs SET last_enriched=? WHERE ra_id=?",
                      (today.isoformat(), aid))
            c.commit()
            continue
        venues = " | ".join(v["name"] for v in (a.get("venuesMostPlayed") or []) if v.get("name"))
        regions = " | ".join(r["name"] for r in (a.get("regionsMostPlayed") or []) if r.get("name"))
        ra_url = "https://ra.co" + (a.get("contentUrl") or f"/dj/{aid}")
        c.execute("""UPDATE djs SET name=COALESCE(?,name), instagram=?, soundcloud=?,
                    bandcamp=?, website=?, discogs=?, ra_followers=?,
                    venues_most_played=?, regions_most_played=?, ra_url=?,
                    image_url=?, cover_image_url=?,
                    last_enriched=? WHERE ra_id=?""",
                  (a.get("name"), a.get("instagram"), a.get("soundcloud"),
                   a.get("bandcamp"), a.get("website"), a.get("discogs"),
                   a.get("followerCount") or 0, venues, regions, ra_url,
                   a.get("image"), a.get("coverImage"),
                   today.isoformat(), aid))
        c.commit()
        done += 1
    return done


def _ig_handle_from_url(u: str | None) -> str:
    if not u:
        return ""
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)", u)
    return m.group(1) if m else ""


def export_djs_csv(c: sqlite3.Connection) -> int:
    rows = c.execute("""SELECT name, ra_followers, genres, instagram, soundcloud,
                        website, bandcamp, discogs, venues_most_played,
                        regions_most_played, bcn_event_count, ra_url,
                        image_url, cover_image_url,
                        first_seen, last_enriched
                        FROM djs
                        ORDER BY ra_followers IS NULL, ra_followers DESC,
                        bcn_event_count DESC""").fetchall()
    with DJS_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["rank", "name", "ra_followers", "genres", "instagram_handle",
                    "instagram_url", "soundcloud_samples", "website", "bandcamp",
                    "discogs", "known_venues", "regions_played", "bcn_events_seen",
                    "ra_url", "image_url", "cover_image_url",
                    "first_seen", "last_enriched"])
        for i, r in enumerate(rows, 1):
            (name, foll, genres, ig, sc, web, bc, dc, venues, regions,
             cnt, url, img, cover, fs, le) = r
            w.writerow([i, name, foll if foll is not None else "", genres or "",
                        _ig_handle_from_url(ig), ig or "", sc or "", web or "",
                        bc or "", dc or "", venues or "", regions or "",
                        cnt or 0, url or "", img or "", cover or "",
                        fs or "", le or ""])
    return len(rows)


def phase_djs(today: dt.date, events: list[dict]) -> None:
    """Harvest DJs from events + past events, keep discovering more via related
    artists, enrich from RA, export. RA-only (no Instagram scraping/limits)."""
    log.info("PHASE DJs: artist profiles")
    c = djs_db()
    try:
        new = harvest_djs(c, events, today)          # tonight's lineups
        if events:                                    # full run only (has events)
            new += harvest_past_djs(c, today)         # DJs who recently played BCN
        discovered = run_dj_discovery(c, today)        # frequent until plateau, then weekly hard sweep
        enriched = enrich_djs(c, today)
        total = export_djs_csv(c)
        log.info("  DJs: +%d harvested, +%d discovered, %d enriched, %d total → djs.csv",
                 new, discovered, enriched, total)
    finally:
        c.close()


def phase2_promoters(today: dt.date, events: list[dict]) -> None:
    log.info("PHASE 2: promoter intelligence")
    c = db()
    now = today.isoformat()

    # 1) Seed set: area promoters + promoters harvested from tonight's events
    seed: dict[str, dict] = {}
    for p in fetch_area_promoters(limit=100):
        if p.get("id"):
            seed[p["id"]] = p
    for e in events:
        for p in (e.get("promoters") or []):
            if p.get("id") and p["id"] not in seed:
                seed[p["id"]] = {"id": p["id"], "name": p.get("name")}
    log.info("  seed promoters: %d", len(seed))

    # 2) Upsert RA facts (fetch detail for RA fields incl facebook/twitter/website)
    for pid, base in seed.items():
        detail = fetch_promoter_detail(pid) or base
        name = detail.get("name")
        area = (detail.get("area") or {}).get("name")
        # Barcelona-based promoters only — skip touring/visiting acts.
        if area != "Barcelona":
            continue
        row = c.execute("SELECT ra_id FROM promoters WHERE ra_id=?", (pid,)).fetchone()
        ra_url = "https://ra.co" + (detail.get("contentUrl") or f"/promoters/{pid}")
        if row:
            c.execute("""UPDATE promoters SET name=?, area=?, follower_count=?,
                        upcoming_events=?, website=COALESCE(?,website),
                        facebook=COALESCE(?,facebook), twitter=COALESCE(?,twitter),
                        ra_url=?, last_ra_update=? WHERE ra_id=?""",
                      (name, area, detail.get("followerCount") or 0,
                       detail.get("upcomingEventsCount") or 0, detail.get("website"),
                       detail.get("facebook"), detail.get("twitter"), ra_url, now, pid))
        else:
            c.execute("""INSERT INTO promoters (ra_id,name,area,follower_count,
                        upcoming_events,website,facebook,twitter,ra_url,
                        works_digitally,first_seen,last_ra_update,source)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (pid, name, area, detail.get("followerCount") or 0,
                       detail.get("upcomingEventsCount") or 0, detail.get("website"),
                       detail.get("facebook"), detail.get("twitter"), ra_url, 0, now, now, "ra"))
    c.commit()

    # 2b) Seed handles (always monitored) + Instagram discovery crawl.
    #     Barcelona guest-list / "rumba" promoters live on IG, not RA, so this is
    #     how the biggest ones (Rumba List, Aashi List, ...) enter the dataset.
    for h in load_seed_handles():
        upsert_ig_promoter(c, h, "manual", now)
    log.info("  seeded manual IG handles: %d", len(load_seed_handles()))

    discover_ig_promoters(c, now)

    # 3) Enrich (Instagram + email). Prioritise biggest, un-enriched first.
    cutoff = (today - dt.timedelta(days=REENRICH_AFTER_DAYS)).isoformat()
    todo = c.execute("""SELECT ra_id,name,website,instagram,email FROM promoters
                        WHERE last_enriched IS NULL OR last_enriched < ?
                        ORDER BY follower_count DESC""", (cutoff,)).fetchall()
    log.info("  promoters to enrich this run: %d", len(todo))
    searches = 0
    for pid, name, website, ig_have, email_have in todo:
        ig = ig_have
        email = email_have
        # (a) scrape their own website — no rate limit
        if website and (not ig or not email):
            s_ig, s_email = scrape_site_for_contacts(website)
            ig = ig or s_ig
            email = email or s_email
            time.sleep(2)
        # (b) throttled fallback search for Instagram only, capped per run + daily
        if not ig and searches < MAX_SEARCHES_PER_RUN and brave_budget_ok(c):
            ig = brave_find_instagram(name)
            _note_brave(c)
            searches += 1
            time.sleep(SEARCH_DELAY)
        works = 1 if (website or ig or email) else 0
        c.execute("""UPDATE promoters SET instagram=?, email=?, works_digitally=?,
                    last_enriched=? WHERE ra_id=?""",
                  (ig, email, works, now, pid))
        c.commit()
        log.info("    %s | IG:%s | email:%s | web:%s",
                 name, ig or "-", email or "-", (website or "-")[:40])

    # 4) Instagram follower/following stats — throttled, stalest first, capped.
    ig_cutoff = (today - dt.timedelta(days=IG_REFRESH_AFTER_DAYS)).isoformat()
    ig_todo = c.execute("""SELECT ra_id, name, instagram FROM promoters
                           WHERE area = 'Barcelona' AND instagram IS NOT NULL
                           AND (ig_last_checked IS NULL OR ig_last_checked < ?)
                           ORDER BY ig_last_checked IS NOT NULL, follower_count DESC
                           LIMIT ?""", (ig_cutoff, MAX_IG_CHECKS_PER_RUN)).fetchall()
    log.info("  IG stats to fetch this run: %d", len(ig_todo))
    for pid, name, handle in ig_todo:
        if not ig_budget_ok(c):
            log.info("  IG daily budget/breaker reached — stopping stats pass")
            break
        prof = guarded_ig_profile(c, handle)
        if prof:
            followers, following = prof["followers"], prof["following"]
            ratio = round(following / followers, 4) if followers else None
            works = 1 if (prof.get("external_url") or followers) else None
            c.execute("""UPDATE promoters SET ig_followers=?, ig_following=?,
                        ig_ratio=?, ig_bio=?, ig_external_url=?, ig_category=?,
                        works_digitally=COALESCE(?,works_digitally),
                        ig_last_checked=?, ig_attempts=0 WHERE ra_id=?""",
                      (followers, following, ratio, prof.get("bio"),
                       prof.get("external_url"), prof.get("category"),
                       works, now, pid))
            c.commit()
            log.info("    IG @%s: %d followers / %d following (ratio %.4f)",
                     handle, followers, following, ratio if ratio is not None else 0)
        else:
            # A failure here is USUALLY Instagram rate-limiting us, not a dead
            # handle. Stamping ig_last_checked on every failure benched 25
            # promoters for 7 days and stalled the whole funnel — so only give
            # up after repeated failures; otherwise stay in the queue.
            c.execute("""UPDATE promoters SET ig_attempts=COALESCE(ig_attempts,0)+1
                         WHERE ra_id=?""", (pid,))
            attempts = c.execute("SELECT COALESCE(ig_attempts,0) FROM promoters "
                                 "WHERE ra_id=?", (pid,)).fetchone()[0]
            # An Instagram-side schema bug on this handle will never succeed —
            # stop retrying it immediately rather than burning 5 attempts.
            if _LAST_IG_STATUS == "account_error":
                c.execute("UPDATE promoters SET ig_last_checked=? WHERE ra_id=?", (now, pid))
                log.info("    IG @%s: unavailable (Instagram account-side error)", handle)
            elif attempts >= 5:
                c.execute("UPDATE promoters SET ig_last_checked=? WHERE ra_id=?", (now, pid))
                log.info("    IG @%s: giving up after %d failed attempts", handle, attempts)
            c.commit()
        time.sleep(IG_STATS_DELAY)

    # 5) Club agreements + guestlist/VIP offers (from bio + website + link-in-bio).
    analyze_and_store_offers(c, today)

    export_promoters_csv(c, today)
    c.close()


def analyze_and_store_offers(c: sqlite3.Connection, today: dt.date) -> None:
    """For each promoter, extract which clubs they work with + free-guestlist/VIP
    (+ any VIP price) from their IG bio, website, and link-in-bio page."""
    now = today.isoformat()
    club_index = build_club_index()
    cutoff = (today - dt.timedelta(days=7)).isoformat()
    todo = c.execute("""SELECT ra_id, name, ig_bio, website, ig_external_url
                        FROM promoters WHERE area = 'Barcelona'
                        AND (offers_checked IS NULL OR offers_checked < ?)
                        ORDER BY ig_followers IS NULL, ig_followers DESC
                        LIMIT 25""", (cutoff,)).fetchall()
    log.info("  offers analysis this run: %d", len(todo))
    for pid, name, bio, website, linkbio in todo:
        texts = [bio or ""]
        # Pull a bit of text from their own pages (cheap, no IG involved).
        for u in (website, linkbio):
            if u:
                texts.append(fetch_visible_text(u))
                time.sleep(1.5)
        res = analyze_offers(texts, club_index)
        c.execute("""UPDATE promoters SET clubs=?, offer_free_guestlist=?,
                    offer_vip=?, vip_price=?, offers_checked=? WHERE ra_id=?""",
                  (" | ".join(res["clubs"]) or None, res["free_guestlist"],
                   res["vip"], res["vip_price"], now, pid))
        c.commit()
        if res["clubs"] or res["free_guestlist"] or res["vip"]:
            log.info("    %s | clubs:%d | free_gl:%s | vip:%s | price:%s",
                     name, len(res["clubs"]), res["free_guestlist"],
                     res["vip"], res["vip_price"] or "-")


def discover_ig_promoters(c: sqlite3.Connection, now: str) -> None:
    """Find NEW Barcelona nightlife promoters via IG related-profiles + search.

    Candidates are validated by bio (Barcelona + nightlife signals + follower
    floor) before being added, so the list stays on-topic. Capped per run.
    """
    known = {r[0] for r in c.execute("SELECT instagram FROM promoters WHERE instagram IS NOT NULL")}
    candidates: list[str] = []

    # (a) Instagram's own "related profiles" from promoters we already track.
    seeds = [r[0] for r in c.execute(
        """SELECT instagram FROM promoters WHERE instagram IS NOT NULL
           AND ig_followers IS NOT NULL ORDER BY ig_followers DESC LIMIT 4""")]
    for h in seeds:
        if not ig_budget_ok(c):
            break
        prof = guarded_ig_profile(c, h)
        time.sleep(IG_STATS_DELAY)
        if not prof:
            continue
        for rel in prof.get("related", []):
            rl = rel.lower()
            if rl not in known and rl not in candidates:
                candidates.append(rl)

    # (b) A few targeted searches for guest-list style promoters.
    for q in ("barcelona guest list instagram", "barcelona nightlife promoter instagram",
              "rumba barcelona lista discoteca instagram"):
        # Leave most of the daily Brave budget for enrichment (finding IG handles
        # for promoters we already track) — that's higher value than new discovery.
        if not brave_budget_ok(c, reserve=BRAVE_DISCOVERY_RESERVE):
            break
        try:
            r = requests.get("https://search.brave.com/search", params={"q": q},
                             headers={"User-Agent": UA}, timeout=WEBSITE_TIMEOUT)
            if r.status_code == 200:
                for m in IG_RE.finditer(r.text):
                    h = m.group(1).strip("/").lower()
                    if _valid_ig_handle(h) and h not in known and h not in candidates:
                        candidates.append(h)
            _note_brave(c)
        except Exception as e:
            log.debug("  discovery search failed: %s", e)
        time.sleep(SEARCH_DELAY)

    # Skip candidates already examined recently, so each night explores new ones.
    recent = {r[0] for r in c.execute(
        "SELECT handle FROM ig_checked WHERE last_checked > ?",
        ((dt.date.fromisoformat(now) - dt.timedelta(days=45)).isoformat(),))}
    candidates = [h for h in candidates if h not in recent]
    log.info("  discovery candidates (new, unchecked): %d", len(candidates))

    # Validate + add. Bounded BOTH by adds and by checks so the run always
    # finishes within a sane window regardless of hit rate.
    added = 0
    checked = 0
    for h in candidates:
        if added >= MAX_IG_DISCOVERY_PER_RUN or checked >= MAX_IG_DISCOVERY_CHECKS:
            break
        if not ig_budget_ok(c):
            log.info("  IG daily budget/breaker reached — stopping discovery")
            break
        checked += 1
        prof = guarded_ig_profile(c, h)
        c.execute("INSERT OR REPLACE INTO ig_checked VALUES (?,?,?)",
                  (h, now, 1 if (prof and is_bcn_nightlife(prof)) else 0))
        c.commit()
        time.sleep(IG_STATS_DELAY)
        if not prof:
            continue
        if is_bcn_nightlife(prof):
            upsert_ig_promoter(c, h, "ig_discovery", now, prof)
            followers = prof["followers"]
            ratio = round(prof["following"] / followers, 4) if followers else None
            c.execute("""UPDATE promoters SET ig_followers=?, ig_following=?, ig_ratio=?,
                        ig_bio=?, ig_external_url=?, ig_category=?, ig_last_checked=?
                        WHERE instagram=?""",
                      (followers, prof["following"], ratio, prof.get("bio"),
                       prof.get("external_url"), prof.get("category"), now, h))
            c.commit()
            added += 1
            log.info("    + discovered @%s (%d followers): %s",
                     h, followers, (prof.get("bio") or "")[:60])
    log.info("  discovered %d new promoters", added)


def export_promoters_csv(c: sqlite3.Connection, today: dt.date) -> None:
    # Ranked by Instagram followers (the metric of interest); promoters whose IG
    # stats aren't fetched yet sort last, then by RA followers.
    rows = c.execute("""SELECT name, ig_followers, ig_following, ig_ratio,
                        follower_count, upcoming_events, works_digitally,
                        instagram, email, website, facebook, twitter, ra_url, area,
                        first_seen, last_enriched, ig_last_checked,
                        COALESCE(source,'ra'), ig_external_url, ig_bio,
                        clubs, offer_free_guestlist, offer_vip, vip_price
                        FROM promoters WHERE area = 'Barcelona'
                        ORDER BY ig_followers IS NULL, ig_followers DESC,
                        follower_count DESC, upcoming_events DESC""").fetchall()
    with PROM_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["rank", "name", "ig_followers", "ig_following", "ig_ratio_following_over_followers",
                    "clubs", "free_guestlist", "vip", "vip_price",
                    "instagram", "email", "website", "source", "ig_link_in_bio", "ig_bio",
                    "ra_followers", "upcoming_events", "works_digitally", "facebook",
                    "twitter", "ra_url", "area", "first_seen", "last_enriched", "ig_last_checked"])
        for i, r in enumerate(rows, 1):
            (name, igf, igg, igr, raf, upc, works, ig, email, web,
             fb, tw, url, area, fs, le, igc, src, ig_url, ig_bio,
             clubs, free_gl, vip, vip_price) = r
            w.writerow([i, name, igf if igf is not None else "",
                        igg if igg is not None else "",
                        igr if igr is not None else "",
                        clubs or "", "yes" if free_gl else ("no" if free_gl == 0 else ""),
                        "yes" if vip else ("no" if vip == 0 else ""), vip_price or "",
                        f"https://instagram.com/{ig}" if ig else "",
                        email or "", web or "", src, ig_url or "",
                        (ig_bio or "").replace("\n", " "),
                        raf if raf is not None else "", upc if upc is not None else "",
                        "yes" if works else "no",
                        fb or "", tw or "", url, area, fs, le or "", igc or ""])

    # Dated markdown top-list for quick reading
    top = rows[:40]
    md = [f"# Barcelona Promoters — top by Instagram followers ({today.isoformat()})\n"]
    md.append(f"_Total promoters tracked: {len(rows)}. "
              f"Ratio = following ÷ followers (lower = more influential)._\n")
    md.append("| # | Promoter | IG followers | Ratio | Free GL | VIP | VIP price | Clubs | Source |")
    md.append("|---|----------|-------------|-------|---------|-----|-----------|-------|--------|")
    for i, r in enumerate(top, 1):
        (name, igf, igg, igr, raf, upc, works, ig, email, web,
         fb, tw, url, area, fs, le, igc, src, ig_url, ig_bio,
         clubs, free_gl, vip, vip_price) = r
        gl = "✅" if free_gl else ("—" if free_gl == 0 else "?")
        vp = "✅" if vip else ("—" if vip == 0 else "?")
        clubs_s = (clubs or "—")
        if len(clubs_s) > 40:
            clubs_s = clubs_s[:38] + "…"
        md.append(f"| {i} | {name} | {igf if igf is not None else '—'} | "
                  f"{igr if igr is not None else '—'} | {gl} | {vp} | "
                  f"{vip_price or '—'} | {clubs_s} | {src} |")
    (PROM_DIR / f"report-{today.isoformat()}.md").write_text("\n".join(md))
    log.info("  exported %s (%d promoters)", PROM_CSV, len(rows))


# ----------------------------------------------------------------------------
# PHASE 3 — club curation: consumer pitches + activate/remove recommendations
# ----------------------------------------------------------------------------

CLUB_FIELDS = ("id,name,slug,is_active,is_featured,is_partner,description,address,"
               "neighborhood,music_genres,rating,ratings_total,reviews,photos,"
               "opening_hours,google_place_id,ra_venue_slug,xceed_venue_id,dice_venue_id")


VENUE_TYPE_DB = CURATION_DIR / "venue_types.sqlite"
VALID_TYPES = ("nightclub", "late_bar", "cocktail_bar", "live_music",
               "restaurant", "cafe", "hotel", "hotel_bar", "other")
# `hotel` (accommodation) is deliberately NOT nightlife: the model was using
# hotel_bar for places people SLEEP, so Casa Li / La avenida / Calderon got
# nightlife pitches about "immaculate rooms". Accommodation is now its own type.
NIGHTLIFE_TYPES = {"nightclub", "late_bar", "cocktail_bar", "live_music", "hotel_bar"}
VENUE_TYPES_CACHE: dict[str, str] = {}
MAX_TYPINGS_PER_RUN = 8


def venue_type_db() -> sqlite3.Connection:
    c = sqlite3.connect(VENUE_TYPE_DB)
    c.execute("""CREATE TABLE IF NOT EXISTS venue_types (
        club_id TEXT PRIMARY KEY, name TEXT, venue_type TEXT, classified_at TEXT)""")
    # Audit trail of pitches THIS job wrote, so a bad batch can be identified
    # and reverted without ever touching human-written descriptions.
    c.execute("""CREATE TABLE IF NOT EXISTS written_pitches (
        club_id TEXT PRIMARY KEY, name TEXT, pitch TEXT, written_at TEXT)""")
    c.commit()
    return c


def load_venue_types() -> dict[str, str]:
    try:
        c = venue_type_db()
        d = {r[0]: r[1] for r in c.execute("SELECT club_id, venue_type FROM venue_types")}
        c.close()
        return d
    except Exception:
        return {}


def classify_venue_type(cl: dict) -> str | None:
    """Ask the local LLM what kind of venue this is, from its name + reviews."""
    revs = cl.get("reviews") if isinstance(cl.get("reviews"), list) else []
    snippets = []
    for r in revs[:4]:
        t = (r.get("text") or "").strip().replace("\n", " ") if isinstance(r, dict) else ""
        if t:
            snippets.append(t[:220])
    close = max(_closing_hours(cl), default=None)
    facts = [f"Venue name: {cl.get('name')}"]
    if close is not None:
        facts.append(f"Latest closing time: {int(close)}:{int((close % 1) * 60):02d}")
    if snippets:
        facts.append("Customer reviews:\n- " + "\n- ".join(snippets))
    prompt = (
        "Classify this Barcelona venue into exactly ONE category.\n\n"
        + "\n".join(facts) +
        "\n\nCategories:\n"
        "nightclub = dance club / discoteca. DJs, a dancefloor, people dancing late\n"
        "late_bar = drinking bar with a going-out atmosphere. NO food focus\n"
        "cocktail_bar = cocktail-focused bar\n"
        "live_music = live music / concert venue / jazz club\n"
        "hotel_bar = a rooftop or hotel BAR people visit for drinks\n"
        "hotel = accommodation. People SLEEP here (rooms, check-in, 'we stayed')\n"
        "restaurant = anywhere people primarily go to EAT\n"
        "cafe = coffee/breakfast place\n"
        "other = anything else\n\n"
        "If the reviews mention staying overnight, rooms, beds, check-in or "
        "breakfast included, answer 'hotel' — NOT 'hotel_bar'.\n\n"
        "CRITICAL RULE — this venue is in Spain, where eating places are called\n"
        "'bars' and stay open late. Closing time and the word 'bar' mean NOTHING.\n"
        "Decide on WHY PEOPLE GO:\n"
        "- If the reviews mostly talk about FOOD (tapas, pintxos, patatas bravas,\n"
        "  paella, croquetas, dishes, menu, lunch, dinner, the chef) then it is\n"
        "  'restaurant' — even if it is called a bar and closes at 3am.\n"
        "- A cerveceria, vermuteria, taperia, tapas bar or beer/craft-beer taproom\n"
        "  is 'restaurant' unless there is dancing or DJs.\n"
        "- Only answer nightclub/late_bar if reviews describe going OUT: dancing,\n"
        "  DJs, music, drinks-led nights out — not a meal.\n\n"
        "Answer with ONLY the single category word, nothing else."
    )
    try:
        out = ollama_generate(prompt, max_tokens=12).strip().lower()
    except Exception as e:
        log.warning("    venue-type LLM failed for %s: %s", cl.get("name"), e)
        return None
    for t in VALID_TYPES:
        if t in out:
            return t
    return None


def _supabase_env() -> tuple[str, str]:
    env = {}
    for line in SUPABASE_ENV.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def sb_get_clubs() -> list[dict]:
    """Fetch every club row (paginated)."""
    base, key = _supabase_env()
    out, offset, page = [], 0, 1000
    while True:
        url = f"{base}/rest/v1/clubs?select={CLUB_FIELDS}&limit={page}&offset={offset}&order=id.asc"
        req = urllib.request.Request(url, headers={
            "apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read())
        out.extend(rows)
        if len(rows) < page:
            break
        offset += page
    return out


def sb_set_description(club_id: str, text: str) -> bool:
    """Write a pitch into description — ONLY if it is still NULL.

    The `description=is.null` filter is a hard guard: even in a race, an existing
    pitch can never be overwritten.
    """
    base, key = _supabase_env()
    url = f"{base}/rest/v1/clubs?id=eq.{urllib.parse.quote(club_id)}&description=is.null"
    body = json.dumps({"description": text}).encode()
    req = urllib.request.Request(url, data=body, method="PATCH", headers={
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json", "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return len(json.loads(r.read())) > 0
    except Exception as e:
        log.warning("    pitch write failed for %s: %s", club_id, e)
        return False


def _has_ticketing(cl: dict) -> bool:
    return any(cl.get(k) for k in ("ra_venue_slug", "xceed_venue_id", "dice_venue_id"))


def _permanently_closed(cl: dict) -> bool:
    oh = cl.get("opening_hours")
    if not isinstance(oh, list) or not oh:
        return False
    return all("closed" in str(x).lower() for x in oh)


def _real_address(cl: dict) -> bool:
    a = (cl.get("address") or "").strip()
    # "Barcelona" alone is a placeholder; a real address has a street/number.
    return len(a) > 12 and any(ch.isdigit() for ch in a)


def _review_count(cl: dict) -> int:
    """Count reviews that actually contain TEXT.

    Counting bare objects let venues through the classification gate with nothing
    for the LLM to read (that is how Espanyol got typed and pitched off an empty
    review), so text is required.
    """
    r = cl.get("reviews")
    if not isinstance(r, list):
        return 0
    return sum(1 for x in r
               if isinstance(x, dict) and (x.get("text") or "").strip())


_TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(AM|PM)", re.I)


def _closing_hours(cl: dict) -> list[float]:
    """Closing times (24h floats) parsed from Google-style opening_hours strings."""
    oh = cl.get("opening_hours")
    if not isinstance(oh, list):
        return []
    hours = []
    for line in oh:
        s = str(line)
        for a, b in ((" ", " "), (" ", " "), ("–", "-"), ("—", "-")):
            s = s.replace(a, b)
        if ":" not in s:
            continue
        rng = s.split(":", 1)[1]           # drop the day name
        if "closed" in rng.lower() or "-" not in rng:
            continue
        m = _TIME_RE.search(rng.rsplit("-", 1)[-1].strip())
        if not m:
            continue
        h = int(m.group(1)) % 12
        if m.group(3).upper() == "PM":
            h += 12
        hours.append(h + int(m.group(2) or 0) / 60)
    return hours


def is_nightlife(cl: dict) -> bool | None:
    """True if it closes in the small hours on any day; None if hours unknown."""
    hrs = _closing_hours(cl)
    if not hrs:
        return None
    return any(1 <= h <= 7 for h in hrs)   # closes 1am-7am → nightlife


def data_gaps(cl: dict) -> list[str]:
    """Fixable data problems — NOT reasons to delete a venue."""
    gaps = []
    if not _real_address(cl):
        gaps.append("no street address")
    if not (isinstance(cl.get("photos"), list) and cl["photos"]):
        gaps.append("no photos")
    if not cl.get("music_genres"):
        gaps.append("no genres")
    return gaps


def classify_club(cl: dict) -> tuple[str | None, list[str]]:
    """Return (verdict, reasons) where verdict in {activate, remove, None}."""
    rating = cl.get("rating") or 0
    votes = cl.get("ratings_total") or 0
    photos = cl.get("photos") if isinstance(cl.get("photos"), list) else []
    night = is_nightlife(cl)
    reasons: list[str] = []

    # --- removal signals: CONSERVATIVE, only venues that are actually dead ---
    # NB: a missing address is a data gap to FIX, never a reason to remove.
    # NB: venue *category* (restaurant vs club) is judged by the LLM, not here —
    #     closing time can't separate a tapas bar from a club in Spain.
    if _permanently_closed(cl):
        reasons.append("listed closed every day (likely shut down)")
    if rating and rating < 3.3 and votes >= 20:
        reasons.append(f"poorly rated ({rating} from {votes})")
    if votes < 5 and _review_count(cl) == 0:
        reasons.append(f"almost no public signal ({votes} ratings, no reviews)")
    if reasons:
        return "remove", reasons

    # --- activation signals (inactive venues only) ---
    # Requires the LLM to have typed it as a nightlife venue (or, if not yet
    # classified, at least late-closing) so we don't surface poke restaurants.
    # Require a CONFIRMED nightlife classification. Falling back to closing time
    # let tapas bars/restaurants through (everything closes late in Spain), so
    # unclassified venues simply wait until the LLM has typed them.
    vtype = VENUE_TYPES_CACHE.get(cl.get("id"))
    if not cl.get("is_active") and vtype in NIGHTLIFE_TYPES:
        if rating >= 4.0 and votes >= 40:
            reasons.append(f"well rated ({rating} from {votes})")
        if votes >= 100:
            reasons.append(f"popular ({votes} ratings)")
        if _has_ticketing(cl):
            reasons.append("listed on a ticketing platform")
        if reasons and photos:
            return "activate", reasons
    return None, []


def write_curation_sheets(clubs: list[dict], today: dt.date) -> tuple[int, int]:
    activate, remove, not_nightlife = [], [], []
    for cl in clubs:
        verdict, reasons = classify_club(cl)
        vtype = VENUE_TYPES_CACHE.get(cl.get("id")) or ""
        row = {
            "name": cl.get("name") or "", "slug": cl.get("slug") or "",
            "is_active": "yes" if cl.get("is_active") else "no",
            "rating": cl.get("rating") or "", "ratings_total": cl.get("ratings_total") or 0,
            "reviews": _review_count(cl), "address": cl.get("address") or "",
            "neighborhood": cl.get("neighborhood") or "",
            "on_ticketing": "yes" if _has_ticketing(cl) else "no",
            "closes": (lambda h: f"{int(max(h))}:{int((max(h) % 1) * 60):02d}" if h else "")(
                _closing_hours(cl)),
            "venue_type": vtype,
            "reason": "; ".join(reasons),
            "data_gaps": "; ".join(data_gaps(cl)),
            "club_id": cl.get("id") or "",
        }
        if verdict == "activate":
            activate.append(row)
        elif verdict == "remove":
            remove.append(row)
        # Separate advisory list: LLM says it isn't a nightlife venue at all.
        if vtype and vtype not in NIGHTLIFE_TYPES:
            r2 = dict(row)
            r2["reason"] = f"classified as {vtype}"
            not_nightlife.append(r2)

    activate.sort(key=lambda r: (-(r["ratings_total"] or 0), r["name"]))
    remove.sort(key=lambda r: (r["is_active"] != "yes", r["name"]))  # active ones first
    not_nightlife.sort(key=lambda r: (r["is_active"] != "yes", -(r["ratings_total"] or 0)))
    cols = ["name", "is_active", "venue_type", "rating", "ratings_total", "reviews",
            "closes", "on_ticketing", "neighborhood", "address", "reason",
            "data_gaps", "slug", "club_id"]
    for path, rows in ((ACTIVATE_CSV, activate), (REMOVE_CSV, remove),
                       (NOT_NIGHTLIFE_CSV, not_nightlife)):
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
    return len(activate), len(remove)


def generate_pitch(cl: dict) -> str | None:
    """One short consumer-facing blurb, grounded in the venue's own data."""
    genres = cl.get("music_genres")
    genres_s = ", ".join(genres) if isinstance(genres, list) and genres else ""
    revs = cl.get("reviews") if isinstance(cl.get("reviews"), list) else []
    snippets = []
    for r in revs[:3]:
        t = (r.get("text") or "").strip().replace("\n", " ") if isinstance(r, dict) else ""
        if t:
            snippets.append(t[:200])
    vtype = VENUE_TYPES_CACHE.get(cl.get("id"))
    facts = [f"Name: {cl.get('name')}"]
    if vtype:
        facts.append(f"Type: {vtype.replace('_', ' ')}")
    if cl.get("neighborhood"):
        facts.append(f"Neighbourhood: {cl['neighborhood']}")
    if genres_s:
        facts.append(f"Music: {genres_s}")
    # NB: rating/review COUNT deliberately withheld — the model just parrots the
    # numbers instead of describing the place, and such copy goes stale.
    if snippets:
        facts.append("What visitors actually say:\n- " + "\n- ".join(snippets))

    # House style, matched to the ~424 pitches already in the app. The UI shows
    # this quoted and attributed ("— Venue Name"), so it must not name itself,
    # must not carry quote marks, and stays short and evocative.
    # Rotate which examples are shown: with a fixed set the 8B model parrots the
    # wording ("late-night revelry", "sprawling", "medieval-style" kept recurring).
    _EXAMPLES = [
        "Five rooms, five sounds. Barcelona's legendary multi-floor venue — indie, techno, pop, and everything in between.",
        "Step into a magical forest for enchanting drinks and whimsical nights.",
        "Decadent bohemian glamour and hidden corners in a grand Placa Reial palace.",
        "Art deco ballroom with world-class bookings. Nitsa club night is legendary.",
        "Lose yourself under crimson lights in this high-energy temple to the night.",
        "Beachside cocktails and easy energy under the Ferris wheel's glow.",
        "Industrial-chic room where live sets give way to DJs as the night stretches on.",
        "Low ceilings, loud bass, and a crowd that treats last call as a suggestion.",
    ]
    import random
    shown = random.sample(_EXAMPLES, 4)
    prompt = (
        "You write the one-line 'Pitch' shown on each venue's page in a Barcelona "
        "nightlife app. Match the TONE and LENGTH of these examples — but never "
        "reuse their wording or imagery:\n\n"
        + "\n".join(shown) +
        "\n\nNow write the pitch for this venue:\n\n"
        + "\n".join(facts) +
        "\n\nRules:\n"
        "- ONE line, 8-18 words (aim for 60-110 characters). Punchy and evocative.\n"
        "- Capture the atmosphere and what it's known for, drawn from the reviews.\n"
        "- Do NOT write the venue's name — it is displayed underneath already.\n"
        "- Do NOT use 'we', 'our' or 'us'.\n"
        "- NEVER mention star ratings, review counts or how popular it is.\n"
        "- Avoid cliches: 'unforgettable', 'hidden gem', 'must-visit', 'vibrant', "
        "'something for everyone', 'experience the nightlife'.\n"
        "- Do NOT use these over-used words: 'revelry', 'sprawling', 'raucous', "
        "'eclectic', 'medieval-style', 'temple to the night'.\n"
        "- Do NOT invent awards, capacity, prices, DJ names or history.\n"
        "- No emojis, no hashtags, no quotation marks.\n"
        "- Output ONLY the pitch line itself."
    )
    try:
        txt = ollama_generate(prompt, max_tokens=140).strip()
    except Exception as e:
        log.warning("    pitch LLM failed for %s: %s", cl.get("name"), e)
        return None
    txt = txt.strip().strip('"').strip()
    txt = re.sub(r"\s+", " ", txt)
    if txt.lower().startswith(("here is", "here's", "sure,")):  # strip preamble if any
        txt = txt.split(":", 1)[-1].strip()
    if len(txt) < 25 or len(txt) > 260:
        log.warning("    pitch rejected (len %d) for %s", len(txt), cl.get("name"))
        return None
    return txt


def phase3_curation(today: dt.date, max_pitches: int = MAX_PITCHES_PER_RUN) -> None:
    """Idle-time work: venue typing, activate/remove sheets, then missing pitches."""
    log.info("PHASE 3: club curation")
    try:
        clubs = sb_get_clubs()
    except Exception as e:
        log.warning("  Supabase fetch failed: %s", e)
        return

    # 1) LLM venue typing for a few unclassified venues (accumulates over runs).
    global VENUE_TYPES_CACHE
    VENUE_TYPES_CACHE = load_venue_types()
    # ONLY classify venues that have review text. With reviews the LLM is
    # accurate; without them it invents a category from the name alone (that's
    # how tapas bars like Vinitus and BAR TOMAS got typed as nightclubs).
    untyped = [c for c in clubs
               if c["id"] not in VENUE_TYPES_CACHE and _review_count(c) >= 3]
    if untyped:
        # Split the batch between active venues (unlocks PITCHES) and inactive
        # ones (unlocks ACTIVATION recommendations). Typing active-first only
        # meant the activate sheet stayed empty for days.
        act_u = sorted((c for c in untyped if c.get("is_active")),
                       key=lambda c: -(c.get("ratings_total") or 0))
        inact_u = sorted((c for c in untyped if not c.get("is_active")),
                         key=lambda c: -(c.get("ratings_total") or 0))
        half = MAX_TYPINGS_PER_RUN // 2
        batch = act_u[:half] + inact_u[:MAX_TYPINGS_PER_RUN - half]
        vc = venue_type_db()
        typed = 0
        for cl in batch:
            vt = classify_venue_type(cl)
            if not vt:
                continue
            vc.execute("INSERT OR REPLACE INTO venue_types VALUES (?,?,?,?)",
                       (cl["id"], cl.get("name"), vt, today.isoformat()))
            vc.commit()
            VENUE_TYPES_CACHE[cl["id"]] = vt
            typed += 1
        vc.close()
        log.info("  venue types: +%d classified (%d/%d done)",
                 typed, len(VENUE_TYPES_CACHE), len(clubs))

    n_act, n_rem = write_curation_sheets(clubs, today)
    log.info("  sheets: %d activate candidates, %d removal candidates (of %d clubs)",
             n_act, n_rem, len(clubs))

    if not PITCH_WRITING_ENABLED:
        log.info("PHASE 3 done: pitch writing disabled — sheets only, nothing written to Supabase")
        return

    todo = [cl for cl in clubs
            if (cl.get("is_active")
                or VENUE_TYPES_CACHE.get(cl["id"]) in NIGHTLIFE_TYPES)
            and not (cl.get("description") or "").strip()]
    log.info("  clubs in scope still missing a pitch: %d", len(todo))

    # Biggest/most-reviewed first so the best venues get copy soonest.
    todo.sort(key=lambda c: -(c.get("ratings_total") or 0))
    written = 0
    for cl in todo[:max_pitches]:
        pitch = generate_pitch(cl)
        if not pitch:
            continue
        if sb_set_description(cl["id"], pitch):
            written += 1
            try:
                ac = venue_type_db()
                ac.execute("INSERT OR REPLACE INTO written_pitches VALUES (?,?,?,?)",
                           (cl["id"], cl.get("name"), pitch, today.isoformat()))
                ac.commit()
                ac.close()
            except Exception as e:
                log.debug("    audit-log write failed: %s", e)
            log.info("    + %s: %s", cl.get("name"), pitch[:80])
        else:
            log.info("    ~ %s: skipped (already had a description)", cl.get("name"))
    log.info("PHASE 3 done: %d pitches written this run", written)


# ----------------------------------------------------------------------------

def main() -> int:
    # Modes:
    #   (default / "full") events + promoters   — manual full run
    #   "events"                                — Phase 1 only (daily digest)
    #   "worker"                                — Phase 2 only (runs every ~30 min,
    #                                             bounded by the shared daily budget)
    mode = sys.argv[1] if len(sys.argv) > 1 else "full"
    today = dt.date.today()

    # Single-instance lock: overlapping runs (worker fires before the previous
    # one finished) exit immediately instead of piling up concurrent IG calls.
    import fcntl
    global _LOCK_FH
    _LOCK_FH = open(ROOT / ".worker.lock", "w")
    try:
        fcntl.flock(_LOCK_FH, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.info("another instance is running (mode=%s) — exiting", mode)
        return 0

    log.info("==== nightly research start %s (mode=%s) ====", today.isoformat(), mode)

    events = []
    if mode in ("full", "events"):
        try:
            res = write_event_report(today)
            events = res["events"]
        except Exception as e:
            log.exception("PHASE 1 crashed: %s", e)
            (DIGESTS_DIR / f"{today.isoformat()}.md").write_text(
                f"# Barcelona Nightlife Intel — {today.isoformat()}\n\n"
                f"_Report generation error: {e}_\n")

    if mode in ("full", "worker"):
        try:
            phase2_promoters(today, events)
        except Exception as e:
            log.exception("PHASE 2 crashed (event report already saved): %s", e)

        # DJ profiles — harvest from events (daily full run) + RA enrichment
        # (every run). RA GraphQL, so no Instagram rate-limit involvement.
        try:
            phase_djs(today, events)
        except Exception as e:
            log.exception("PHASE DJs crashed (other phases already saved): %s", e)

        # PHASE 3 fills the idle time left over from Instagram's rate limits:
        # local-LLM venue typing + pitches (no external quota involved).
        try:
            phase3_curation(today)
        except Exception as e:
            log.exception("PHASE 3 crashed (phases 1-2 already saved): %s", e)

    log.info("==== nightly research done (mode=%s) ====", mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
