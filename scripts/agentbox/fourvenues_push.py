#!/usr/bin/env python3
"""Publish offers.json to Supabase Storage for the app to pull.

DEPLOYED TO THE AGENTBOX — lives at ~/scraper/fourvenues_push.py and runs from
cron right after fourvenues_map.py. Redeploy:

    scp scripts/agentbox/fourvenues_push.py agentbox:~/scraper/fourvenues_push.py

Writes storage bucket `fourvenues` (public), object `offers.json`:

    <SUPABASE_URL>/storage/v1/object/public/fourvenues/offers.json

Public on purpose: it is the same event data anyone sees on Fourvenues' own
pages. The app reads it with no session, which also covers guests browsing
signed out. Compact JSON, because every phone downloads it hourly.

A file rather than tables because it needs no manual migration and the app
already decodes exactly this shape. When the portal needs to query offers,
external_events / external_products tables take over and this can stay as the
app's cache-friendly read.

Usage:
    ~/scraper/venv/bin/python3 ~/scraper/fourvenues_push.py [--dry-run]
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OFFERS = ROOT / "intel" / "fourvenues" / "offers.json"
SECRETS = ROOT / "secrets" / "supabase.env"
BUCKET = "fourvenues"
OBJECT = "offers.json"
# Short enough that the hourly refresh is seen promptly through any CDN cache.
CACHE_SECONDS = 300


def supabase_env() -> tuple[str, str]:
    """Same parse as push_events.supabase_env()."""
    env: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def call(url: str, key: str, *, method: str, body: bytes, ctype: str,
         extra: dict[str, str] | None = None) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body, method=method, headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": ctype, **(extra or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def hidden_brands(base: str, key: str) -> set[str]:
    """Keys of brands switched off in the portal. Unreadable → none (publish as
    normal): a failed lookup must not take the whole catalog off sale."""
    req = urllib.request.Request(
        f"{base}/rest/v1/partner_brands?offers_hidden=eq.true&select=key",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return {row["key"] for row in json.loads(r.read().decode())}
    except Exception as e:  # noqa: BLE001
        print(f"could not read brand switches ({e}) — publishing as normal")
        return set()


def main() -> int:
    data = json.loads(OFFERS.read_text())
    if not data.get("events"):
        # An empty map means the reader failed, not that the channel is empty.
        # Publishing it would blank every club page in the app.
        print("offers.json has no events — not publishing")
        return 1
    base, key = supabase_env()

    # Each brand's portal switch. A brand "off" (partner_brands.offers_hidden)
    # takes ITS Fourvenues lists, tickets and tables out of the app — other
    # brands' nights are untouched. Publish its nights with NO products rather
    # than no nights: the app keeps its last good copy when the feed is empty,
    # so an empty file would leave everything on sale. No products = no
    # Guestlist button, no paid entry, no VIP for that brand, anywhere.
    off = hidden_brands(base, key)
    for e in data["events"]:
        if e.get("brand", "hypelist") in off:
            e["products"] = []
            e["vip_map"] = None
    hidden = sorted(off & {e.get("brand", "hypelist") for e in data["events"]})

    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    if "--dry-run" in sys.argv:
        print(f"would publish {len(data['events'])} events, {len(body)} bytes, off: {hidden or 'none'}")
        return 0

    # Idempotent: 400/409 "already exists" is the normal answer after the first run.
    status, text = call(f"{base}/storage/v1/bucket", key, method="POST", ctype="application/json",
                        body=json.dumps({"id": BUCKET, "name": BUCKET, "public": True}).encode())
    if status not in (200, 201) and "exist" not in text.lower():
        print(f"bucket create failed: {status} {text}")
        return 1

    status, text = call(f"{base}/storage/v1/object/{BUCKET}/{OBJECT}", key, method="POST",
                        ctype="application/json", body=body,
                        extra={"x-upsert": "true", "cache-control": f"max-age={CACHE_SECONDS}"})
    if status not in (200, 201):
        print(f"upload failed: {status} {text}")
        return 1
    print(f"published {len(data['events'])} events ({len(body)} bytes) run {data.get('run')}"
          + (f" — OFF in portal, nothing on sale: {', '.join(hidden)}" if hidden else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
