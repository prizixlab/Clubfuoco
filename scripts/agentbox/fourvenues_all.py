#!/usr/bin/env python3
"""Read, map and merge every brand's Fourvenues channel into one offers.json.

DEPLOYED TO THE AGENTBOX — ~/scraper/fourvenues_all.py, run hourly by cron in
place of the single-channel reader → zones → map chain:

    fourvenues_all.py && fourvenues_i18n.py && fourvenues_push.py && fourvenues_nights.py

For each brand with a channel (fourvenues_channels.brands(), oldest first) it
runs the same three steps HypeList's channel always had:

    fourvenues_reader.py --channel <ch>     the public pages, recorded
    fourvenues_zones.py  --channel <ch>     table capacities and floor plans
    fourvenues_map.py    --channel <ch>     → intel/fourvenues/offers-<ch>.json

then merges the per-channel files into intel/fourvenues/offers.json:

  * every event carries `channel` and `brand` (the brand's key);
  * the top level carries `brands` — key → name, colour, logo, channel — so
    the app credits each night to the brand that sells it;
  * ONE product, ONE seller: when two channels list the same Fourvenues event
    (same code), the older brand keeps it and the other copy is dropped.

A channel whose read fails this hour keeps its last good per-channel file, so
one brand's outage never empties another's — or its own — nights.
"""

from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import fourvenues_channels

ROOT = Path(__file__).resolve().parent
DIR = ROOT / "intel" / "fourvenues"
PY = sys.executable


def step(*args: str) -> bool:
    r = subprocess.run([PY, *args], cwd=ROOT)
    return r.returncode == 0


def main() -> int:
    quiet = ["--quiet"] if "--quiet" in sys.argv else []
    try:
        brands = fourvenues_channels.brands()
    except Exception as e:  # noqa: BLE001
        print(f"all: brands unreadable ({e}) — nothing read")
        return 1
    if not brands:
        print("all: no brand has a Fourvenues channel")
        return 0

    for b in brands:
        ch = b["channel"]
        print(f"all: {b['key']} ← {ch}", flush=True)
        if "--map-only" not in sys.argv:
            step("fourvenues_reader.py", "--channel", ch, *quiet)
            step("fourvenues_zones.py", "--channel", ch, *quiet)
        if not step("fourvenues_map.py", "--channel", ch, "--out", str(DIR / f"offers-{ch}.json")):
            print(f"all: {ch} has no mapped run yet — kept its last file, if any")

    events: list[dict] = []
    seen: dict[str, str] = {}
    meta: dict[str, dict] = {}
    for b in brands:
        f = DIR / f"offers-{b['channel']}.json"
        if not f.exists():
            continue
        feed = json.loads(f.read_text())
        meta[b["key"]] = {"name": b["name"], "color": b.get("color"),
                          "logo_url": b.get("logo_url"), "channel": b["channel"]}
        kept = dropped = 0
        for e in feed.get("events", []):
            if e["code"] in seen:
                dropped += 1
                continue
            seen[e["code"]] = b["key"]
            events.append({**e, "channel": b["channel"], "brand": b["key"]})
            kept += 1
        print(f"all: {b['key']}: {kept} nights" + (f", {dropped} already sold by another brand" if dropped else ""))

    if not events:
        print("all: no events from any channel — offers.json left as it was")
        return 1
    events.sort(key=lambda e: e["starts_at"])
    out = {
        # Kept for the app's older readers, which expect one channel.
        "channel": brands[0]["channel"],
        "brands": meta,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "events": events,
    }
    (DIR / "offers.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"all: offers.json — {len(events)} nights from {len(meta)} brand(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
