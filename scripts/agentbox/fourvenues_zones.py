#!/usr/bin/env python3
"""Table capacities for every Fourvenues table zone on our channel.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/fourvenues_zones.py and runs
from cron between fourvenues_reader.py and fourvenues_map.py. Redeploy:

    scp scripts/agentbox/fourvenues_zones.py agentbox:~/scraper/fourvenues_zones.py

── Why this exists ──────────────────────────────────────────────────────────
The zones list the reader records gives each table rate a name, an id and a
price — but not how many people it takes. "Orange Table · 300€ for 4" only
appears on the zone's own page, which Fourvenues renders on the server, so
the HTML already carries, per rate:

    id="rate-<rateId>" data-pax-posibilities="[1,2,3,4]"   ← allowed group sizes
    {"_id":"<rateId>", … "max_personas":6, … "fianza":50,
     "fianza_tipo":"porcentaje", … "full_payment":true, …}    ← max, deposit

Plain HTTP, no browser: it is the public page any visitor opens.

── Cost control ─────────────────────────────────────────────────────────────
Zone pages are ~500 KB and capacities rarely change, so a zone is fetched only
when its stored answer is older than STALE_HOURS. One request at a time with a
pause, a per-run cap, and the same lock as the reader so they never overlap.

Writes table `zone_rates` in intel/fourvenues/fourvenues.sqlite.

Usage:
    ~/scraper/venv/bin/python3 ~/scraper/fourvenues_zones.py [--limit N] [--force]
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import logging
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SQLITE = ROOT / "intel" / "fourvenues" / "fourvenues.sqlite"
LOCK = ROOT / ".fourvenues.lock"
WEB = "https://web.fourvenues.com/en/iframe"
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Mobile/15E148")
STALE_HOURS = 12
PAUSE_S = (1.0, 2.5)
DEFAULT_LIMIT = 700

PAX_RX = re.compile(r'id="rate-([a-z0-9]{32})"\s+data-pax-posibilities="\[([0-9,\s]*)\]"')

log = logging.getLogger("fourvenues_zones")


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def rate_meta(html: str, rate_id: str) -> dict:
    """max_personas / deposit / full_payment from the rate's JSON record."""
    m = re.search(r'\{"_id":"%s","negocio_id"(.{0,4000}?)"removed_at"' % re.escape(rate_id), html)
    if not m:
        return {}
    blob = m.group(1)

    def grab(key: str, rx: str = r'([^,}\]]+)'):
        g = re.search(r'"%s":%s' % (re.escape(key), rx), blob)
        return g.group(1).strip('"') if g else None

    out: dict = {}
    if (v := grab("max_personas")) and v.isdigit():
        out["max"] = int(v)
    if (v := grab("fianza")) is not None:
        try:
            out["deposit"] = float(v)
        except ValueError:
            pass
    if (v := grab("fianza_tipo")):
        out["deposit_type"] = v            # porcentaje | fijo
    if (v := grab("full_payment")):
        out["full_payment"] = v == "true"
    if (v := grab("descripcion", r'"((?:[^"\\]|\\.)*)"')):
        try:
            out["description"] = json.loads(f'"{v}"') or None
        except json.JSONDecodeError:
            pass
    return out


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    ap.add_argument("--force", action="store_true", help="refetch even fresh zones")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING if args.quiet else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    lock_fh = open(LOCK, "w")
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.info("reader holds the lock; exiting")
        return 0

    con = sqlite3.connect(SQLITE)
    con.executescript("""
        create table if not exists zone_rates (
          zone_id     text not null,
          rate_id     text not null,
          code        text not null,
          pax         text not null,     -- JSON array of allowed group sizes
          max_pax     integer,
          deposit     real,
          deposit_type text,
          full_payment integer,
          description text,
          fetched_at  text not null,
          primary key (zone_id, rate_id)
        );
        create table if not exists zone_fetches (
          zone_id    text primary key,
          code       text not null,
          fetched_at text not null,
          ok         integer not null,
          error      text
        );
    """)

    run, channel = con.execute(
        "select id, channel from runs where finished_at is not null and events_read > 0"
        " order by id desc limit 1").fetchone()

    # Every zone in the newest run, with the event's slug for the page URL.
    zones: list[tuple[str, str, str]] = []
    for code, body in con.execute(
            "select code, body from raw where run_id=? and endpoint='zones' and status=200", (run,)):
        ev = con.execute("select body from raw where run_id=? and code=? and endpoint='event'"
                         " and status=200 limit 1", (run, code)).fetchone()
        if not ev:
            continue
        try:
            slug = json.loads(ev[0])["data"]["slug"]
            for z in json.loads(body).get("data") or []:
                zones.append((code, slug, z["id"]))
        except (json.JSONDecodeError, KeyError, TypeError):
            continue

    cutoff = (now() - dt.timedelta(hours=STALE_HOURS)).isoformat()
    fresh = {z for (z,) in con.execute(
        "select zone_id from zone_fetches where ok=1 and fetched_at > ?", (cutoff,))}
    todo = [z for z in zones if args.force or z[2] not in fresh]
    log.info("%d zones in run %d, %d to fetch", len(zones), run, len(todo))

    done = failed = 0
    for code, slug, zone_id in todo[: args.limit]:
        url = f"{WEB}/{channel}/events/{slug}-{code}/bookings/{zone_id}"
        ts = now().isoformat(timespec="seconds")
        try:
            html = fetch(url)
            if "verify you are human" in html.lower() or "no bots on the guest list" in html.lower():
                raise RuntimeError("challenge page")
            rows = []
            for rate_id, pax in PAX_RX.findall(html):
                sizes = sorted({int(p) for p in pax.split(",") if p.strip().isdigit()})
                meta = rate_meta(html, rate_id)
                rows.append((zone_id, rate_id, code, json.dumps(sizes), meta.get("max"),
                             meta.get("deposit"), meta.get("deposit_type"),
                             None if meta.get("full_payment") is None else int(meta["full_payment"]),
                             meta.get("description"), ts))
            con.execute("delete from zone_rates where zone_id=?", (zone_id,))
            con.executemany("insert into zone_rates values (?,?,?,?,?,?,?,?,?,?)", rows)
            con.execute("insert or replace into zone_fetches values (?,?,?,1,null)", (zone_id, code, ts))
            done += 1
        except Exception as e:  # one bad zone must not sink the run
            failed += 1
            con.execute("insert or replace into zone_fetches values (?,?,?,0,?)",
                        (zone_id, code, ts, str(e)[:300]))
            log.warning("%s %s failed: %s", code, zone_id, e)
            if "challenge" in str(e):
                con.commit()
                break
        con.commit()
        time.sleep(random.uniform(*PAUSE_S))

    log.info("zones: %d fetched, %d failed", done, failed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
