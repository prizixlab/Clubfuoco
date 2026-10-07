#!/usr/bin/env python3
"""Read every event on our Fourvenues channel into a local SQLite snapshot.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/fourvenues_reader.py and runs
from its cron. The copy here is for version control; after editing:

    scp scripts/agentbox/fourvenues_reader.py agentbox:~/scraper/fourvenues_reader.py

── What this is for ─────────────────────────────────────────────────────────
HypeList gave us a referral channel on Fourvenues, not an API key:

    https://site.fourvenues.com/en/iframe/clubfuoco-hype/events

The app sells from that channel with its own UI and hands the buyer to
Fourvenues only for the last step (details form + Apple Pay). To do that it
needs, per event, every product on sale — tickets, guestlists, table zones and
their rates — WITH the ids that Fourvenues' checkout URLs are built from:

    …/events/<slug>-<CODE>/tickets/<ticketTypeId>/<qty>/form
    …/events/<slug>-<CODE>/bookings/<zoneId>/2?pax=<n>&rate=<rateId>

── How it reads, and what it deliberately does NOT do ───────────────────────
The page is an Angular app that fetches its data from cli-api-service.
fourvenues.com. That API refuses anyone but Fourvenues' own site (401 without
the site's app key). We do NOT lift that key and call the API ourselves.

Instead a real headless browser opens the public page exactly as a visitor
would, and we RECORD the JSON the page receives. The rendered page never shows
the ids (the buttons route in JavaScript), so recording is the only way to get
them without clicking every product.

Stage 1 (this file) stores those responses raw, per event, per endpoint. The
mapping into `external_products` is a separate step, so a change in Fourvenues'
JSON shape breaks the mapper — loudly, re-runnable against the stored raw —
and never the harvest.

── Politeness ───────────────────────────────────────────────────────────────
One browser, one page at a time, a pause between events, a per-run cap, and a
single-instance lock so overlapping cron fires exit immediately. Queue-Fair and
Cloudflare sit in front of this site; a challenge page is recorded as a failed
read and the run stops early rather than hammering it.

Usage:
    ~/scraper/venv/bin/python3 ~/scraper/fourvenues_reader.py [--limit N]
        [--codes LNKO,G7QJ] [--channel clubfuoco-hype] [--quiet]
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import logging
import random
import re
import sqlite3
import sys
import time
from pathlib import Path

from playwright.sync_api import Response, sync_playwright

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "intel" / "fourvenues"
SQLITE = OUT_DIR / "fourvenues.sqlite"
LOCK = ROOT / ".fourvenues.lock"

SITE = "https://site.fourvenues.com"
API_HOST = "cli-api-service.fourvenues.com"
DEFAULT_CHANNEL = "clubfuoco-hype"

# Event codes are 4 uppercase alphanumerics at the end of the event path:
# /events/LNKO or /events/jet-lag-01-10-2026-LNKO.
CODE_RE = re.compile(r"/events/(?:[^/?#]*-)?([A-Z0-9]{4})(?:[/?#]|$)")

# The endpoints worth keeping, by the name we file them under. Anything else
# the page calls (fees, feature flags, microsite) is kept under "other" — cheap,
# and it means a new product type shows up in the raw data before we know its
# name.
ENDPOINTS = [
    ("tickets", re.compile(r"/api/events/[^/]+/tickets-types")),
    ("guestlists", re.compile(r"/api/events/[^/]+/guestlist-types")),
    ("zones", re.compile(r"/api/events/[^/]+/bookings-zones")),
    ("rates", re.compile(r"/api/.*(rates|bookings-rates|zones/[^/]+)")),
    ("event", re.compile(r"/api/events/[A-Z0-9]{4}\?")),
    ("fees", re.compile(r"/api/fees")),
    ("listing", re.compile(r"/api/(events|microsites/[^/]+/events)\?")),
]

PAUSE_S = (2.5, 5.0)
KEEP_RUNS = 48
DEFAULT_LIMIT = 400
SETTLE_MS = 2500

log = logging.getLogger("fourvenues_reader")


def classify(url: str) -> str:
    for name, rx in ENDPOINTS:
        if rx.search(url):
            return name
    return "other"


def db() -> sqlite3.Connection:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(SQLITE)
    con.executescript(
        """
        create table if not exists runs (
          id          integer primary key,
          channel     text not null,
          started_at  text not null,
          finished_at text,
          events_seen integer,
          events_read integer,
          failures    integer,
          stopped     text
        );
        -- One row per (event, endpoint, url) per run. Raw on purpose: the
        -- mapper reads the latest run, and older runs are history for diffing
        -- ("when did this release sell out").
        create table if not exists raw (
          run_id      integer not null,
          channel     text not null,
          code        text,
          endpoint    text not null,
          url         text not null,
          status      integer not null,
          body        text,
          fetched_at  text not null
        );
        create index if not exists raw_code_idx on raw(channel, code, run_id);
        create table if not exists events_seen (
          channel     text not null,
          code        text not null,
          first_seen  text not null,
          last_seen   text not null,
          last_read   text,
          last_error  text,
          primary key (channel, code)
        );
        """
    )
    return con


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def is_challenge(html: str) -> bool:
    h = html.lower()
    return ("verify you are human" in h or "cf-challenge" in h
            or "queue-fair" in h and "you are now in line" in h)


class Recorder:
    """Collects the API responses the page makes while one URL is open.

    The handler only keeps the Response; bodies are read afterwards in
    `drain()`. Reading a body from inside a sync-API event handler blocks the
    dispatcher that is delivering it.
    """

    def __init__(self) -> None:
        self.pending: list[Response] = []

    def __call__(self, resp: Response) -> None:
        # generateGuestToken's body is a session credential for the page, not
        # data about the event. Never write it to disk.
        if API_HOST in resp.url and "generateGuestToken" not in resp.url:
            self.pending.append(resp)

    def seen(self) -> set[str]:
        return {classify(r.url) for r in self.pending}

    def drain(self) -> list[tuple[str, str, int, str | None]]:
        out = []
        for r in self.pending:
            try:
                body: str | None = r.text()
            except Exception:  # redirects, aborted requests
                body = None
            out.append((classify(r.url), r.url, r.status, body))
        self.pending = []
        return out


def list_codes(page, channel: str) -> list[str]:
    """Every event code on the channel's listing.

    The listing loads in chunks that REPLACE earlier cards in the DOM (see the
    BesoList harvest notes), so codes are collected while scrolling rather than
    read once at the end.
    """
    page.goto(f"{SITE}/en/iframe/{channel}/events", wait_until="domcontentloaded")
    page.wait_for_timeout(SETTLE_MS * 2)
    if is_challenge(page.content()):
        raise RuntimeError("challenge page on the listing")
    codes: list[str] = []
    stale = 0
    while stale < 4:
        hrefs = page.eval_on_selector_all(
            "a[href*='/events/']", "els => els.map(e => e.getAttribute('href'))")
        before = len(codes)
        for h in hrefs:
            m = CODE_RE.search(h or "")
            if m and m.group(1) not in codes:
                codes.append(m.group(1))
        stale = stale + 1 if len(codes) == before else 0
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(1200)
    return codes


# The three lists every event page asks for. "networkidle" never arrives on
# this site — analytics beacons keep the network busy — so a read is done when
# these have landed, or when the wait runs out (an event may genuinely lack one).
WANTED = {"tickets", "guestlists", "zones"}
READ_TIMEOUT_MS = 20000


def read_event(page, channel: str, code: str, rec: Recorder) -> str:
    page.goto(f"{SITE}/en/iframe/{channel}/events/{code}", wait_until="domcontentloaded")
    waited = 0
    while not WANTED <= rec.seen() and waited < READ_TIMEOUT_MS:
        page.wait_for_timeout(500)
        waited += 500
    page.wait_for_timeout(SETTLE_MS)  # stragglers: fees, the event body
    if is_challenge(page.content()):
        raise RuntimeError("challenge page")
    return page.url


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--channel", default=DEFAULT_CHANNEL)
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    ap.add_argument("--codes", help="comma-separated event codes; skips the listing")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    lock_fh = open(LOCK, "w")
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.info("another run holds the lock; exiting")
        return 0

    con = db()
    run_id = con.execute(
        "insert into runs(channel, started_at) values (?, ?)",
        (args.channel, now())).lastrowid
    con.commit()

    rec = Recorder()
    read = failures = 0
    stopped: str | None = None
    codes: list[str] = []

    def store(code: str | None) -> None:
        con.executemany(
            "insert into raw(run_id, channel, code, endpoint, url, status, body, fetched_at)"
            " values (?,?,?,?,?,?,?,?)",
            [(run_id, args.channel, code, e, u, s, b, now()) for e, u, s, b in rec.drain()])

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(locale="en-GB", timezone_id="Europe/Madrid",
                                  viewport={"width": 1280, "height": 1600})
        page = ctx.new_page()
        page.on("response", rec)

        try:
            if args.codes:
                codes = [c.strip().upper() for c in args.codes.split(",") if c.strip()]
            else:
                codes = list_codes(page, args.channel)
                store(None)  # the listing's own responses, filed under no event
            log.info("%d events on %s", len(codes), args.channel)

            for code in codes[: args.limit]:
                ts = now()
                con.execute(
                    "insert into events_seen(channel, code, first_seen, last_seen)"
                    " values (?,?,?,?) on conflict(channel, code) do update set last_seen=excluded.last_seen",
                    (args.channel, code, ts, ts))
                try:
                    final_url = read_event(page, args.channel, code, rec)
                    got = rec.seen()
                    store(code)
                    con.execute(
                        "update events_seen set last_read=?, last_error=null where channel=? and code=?",
                        (ts, args.channel, code))
                    read += 1
                    log.info("%s  %s  %s", code, ",".join(sorted(got)) or "(no api calls)", final_url)
                except Exception as e:  # one bad event must not sink the run
                    failures += 1
                    rec.pending = []
                    con.execute(
                        "update events_seen set last_error=? where channel=? and code=?",
                        (str(e)[:300], args.channel, code))
                    log.warning("%s failed: %s", code, e)
                    if "challenge" in str(e):
                        stopped = f"challenge at {code}"
                        break
                con.commit()
                time.sleep(random.uniform(*PAUSE_S))
        except Exception as e:
            stopped = str(e)[:300]
            log.error("run stopped: %s", e)
        finally:
            browser.close()

    con.execute(
        "update runs set finished_at=?, events_seen=?, events_read=?, failures=?, stopped=? where id=?",
        (now(), len(codes), read, failures, stopped, run_id))
    # Hourly runs store ~6 MB of raw JSON each. Keep two days of history for
    # diffing ("when did this release sell out") and drop the rest.
    con.execute("delete from raw where run_id not in (select id from runs order by id desc limit ?)",
                (KEEP_RUNS,))
    con.commit()
    log.info("run %d: %d/%d read, %d failed%s", run_id, read, len(codes), failures,
             f", stopped: {stopped}" if stopped else "")
    return 1 if stopped else 0


if __name__ == "__main__":
    sys.exit(main())
