#!/usr/bin/env python3
"""Turn unresolved event venues into real clubs, with Google Places photos.

Half the scraped events sit on venues that aren't in `clubs`, so they can't
attach to a club (and their lone-DJ nights can't box). This finds those venues,
checks each against Google **Places API (New)**, and — if Places says it's a
nightlife venue (type `bar` / `night_club`, the same gate as /api/admin/discover,
which excludes comedy clubs, theatres, parks, pure hotels) — creates the club and
MIRRORS its Places photos into the Supabase `venue-photos` bucket (the app rejects
hot-linked Google photo URLs, so we re-host, matching existing clubs).

Runs on the agentbox (working SSL + GOOGLE_PLACES_API_KEY in secrets). One-off /
occasional backfill, not cron. After it runs, re-run push_events.py (to resolve
the newly-matchable events) then link_djs.py.

    scp scripts/agentbox/ingest_venues.py yvinnik@10.0.0.235:~/scraper/
    ~/scraper/venv/bin/python3 ~/scraper/ingest_venues.py [--dry-run] [--limit N]
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SECRETS = ROOT / "secrets" / "supabase.env"
PLACES_NEW = "https://places.googleapis.com/v1"
FIELD_MASK = ("places.id,places.displayName,places.types,places.formattedAddress,"
              "places.location,places.rating,places.userRatingCount,places.photos")
MAX_PHOTOS = 3

# These venues all come from Resident Advisor EVENT listings, so they're already
# music/nightlife venues. Google's New Places types are unreliable for clubs
# (Noxe = "restaurant", DETROIT = "event_venue", Dr. Dou = "cultural_center"), so
# instead of an allow-list we accept any real match EXCEPT an explicit denylist —
# comedy clubs (the user's exclusion), theatres, parks, and other non-nightlife.
EXCLUDE_TYPES = {
    "comedy_club", "movie_theater", "performing_arts_theater", "amusement_park",
    "park", "national_park", "zoo", "aquarium", "museum", "art_gallery",
    "church", "place_of_worship", "hospital", "doctor", "pharmacy",
    "school", "primary_school", "secondary_school", "university",
    "city_hall", "local_government_office", "courthouse", "police", "cemetery",
    "shopping_mall", "supermarket", "grocery_store", "gym", "parking",
    "train_station", "transit_station", "bus_station", "airport",
}
# Tokens too generic to prove a name matches the venue we searched for.
GENERIC = {
    "barcelona", "bcn", "club", "bar", "the", "de", "del", "la", "el", "los",
    "las", "and", "cocktail", "music", "beach", "rooftop", "terrace", "terraza",
    "sala", "disco", "hotel", "restaurant", "lounge", "social", "dance", "night",
    "sound", "sound_lab", "barcelone",
}
log = logging.getLogger("ingest_venues")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _core(s: str) -> set[str]:
    return {t for t in _norm(s).split() if len(t) > 1 and t not in GENERIC}


def env() -> tuple[str, str, str]:
    e: dict[str, str] = {}
    for line in SECRETS.read_text().splitlines():
        m = re.match(r'^([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            e[m.group(1)] = m.group(2)
    return (e["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"),
            e["SUPABASE_SERVICE_ROLE_KEY"], e["GOOGLE_PLACES_API_KEY"])


def sb(base, key, path, *, method="GET", body=None, prefer=None, raw=False):
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    data = body
    if body is not None and not raw:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(f"{base}/rest/v1/{path}", data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        out = r.read()
    return json.loads(out) if out else None


def storage_put(base, key, path, data, content_type):
    req = urllib.request.Request(
        f"{base}/storage/v1/object/{path}", data=data, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": content_type,
                 "x-upsert": "true"})
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()


def http_get(url, headers=None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "club"


def places_lookup(venue: str, pkey: str) -> dict | None:
    """First Places (New) hit that isn't a denylisted type AND whose name
    actually matches the venue we searched for (guards against wrong matches)."""
    req = urllib.request.Request(
        f"{PLACES_NEW}/places:searchText",
        data=json.dumps({"textQuery": f"{venue} Barcelona", "regionCode": "ES",
                         "maxResultCount": 5}).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": pkey,
                 "X-Goog-FieldMask": FIELD_MASK})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    qcore = _core(venue)
    for p in data.get("places", []):
        types = set(p.get("types", []))
        if types & EXCLUDE_TYPES:
            continue
        name = p.get("displayName", {}).get("text") or ""
        # Name guard: the result must share a distinctive token with the query
        # (rejects e.g. "La Cantera-Underground Techno" → "La Terrrazza").
        if qcore and not (_core(name) & qcore):
            continue
        loc = p.get("location", {})
        return {
                "id":            p["id"],
                "name":          p.get("displayName", {}).get("text") or query,
                "types":         p.get("types", []),
                "address":       p.get("formattedAddress", ""),
                "lat":           loc.get("latitude"),
                "lng":           loc.get("longitude"),
                "rating":        p.get("rating"),
                "ratings_total": p.get("userRatingCount") or 0,
                "photo_names":   [ph["name"] for ph in p.get("photos", [])[:MAX_PHOTOS]],
            }
    return None


def fetch_photo(photo_name: str, pkey: str) -> bytes:
    # New API media endpoint 302s to the CDN; urllib follows it.
    return http_get(f"{PLACES_NEW}/{photo_name}/media?maxWidthPx=800&key={pkey}")


def main() -> int:
    dry = "--dry-run" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s ingest_venues %(levelname)s %(message)s")
    base, key, pkey = env()

    # Distinct unresolved venue names, by event count desc; drop TBA/blank.
    rows: list[dict] = []
    off = 0
    while True:
        page = sb(base, key, f"events?select=venue_name&club_id=is.null&limit=1000&offset={off}")
        rows += page
        if len(page) < 1000:
            break
        off += 1000
    counts: dict[str, int] = {}
    for r in rows:
        v = (r.get("venue_name") or "").strip()
        if v and not v.upper().startswith("TBA"):
            counts[v] = counts.get(v, 0) + 1
    venues = sorted(counts, key=lambda v: -counts[v])
    if limit:
        venues = venues[:limit]

    known_pid = {c["google_place_id"] for c in
                 sb(base, key, "clubs?select=google_place_id&google_place_id=not.is.null")
                 if c.get("google_place_id")}
    slugs = {c["slug"] for c in sb(base, key, "clubs?select=slug") if c.get("slug")}
    log.info("%d unresolved venues to check (%d clubs already have a place id)",
             len(venues), len(known_pid))

    added = skipped_notclub = skipped_known = errors = 0
    for v in venues:
        try:
            hit = places_lookup(v, pkey)
        except urllib.error.HTTPError as e:
            log.error("places lookup failed for %r: %s %s", v, e.code, e.read()[:160])
            errors += 1
            continue
        except Exception as e:                      # noqa: BLE001
            log.warning("places lookup error for %r: %s", v, e); errors += 1; continue
        if not hit:
            skipped_notclub += 1
            log.info("SKIP not-a-club: %s (%d events)", v, counts[v]); continue
        if hit["id"] in known_pid:
            skipped_known += 1; continue

        if dry:
            log.info("WOULD ADD: %-30s ← %-26s  types=%s  photos=%d  (%d events)",
                     hit["name"], v, ",".join(hit["types"][:3]),
                     len(hit["photo_names"]), counts[v]); added += 1; continue

        cid = str(uuid.uuid4())
        slug = slugify(hit["name"])
        if slug in slugs:
            slug = f"{slug}-{cid[:4]}"
        slugs.add(slug)

        # Mirror up to 3 Places photos into the venue-photos bucket.
        urls = []
        for i, pn in enumerate(hit["photo_names"]):
            try:
                img = fetch_photo(pn, pkey)
                fname = f"{cid}.jpg" if i == 0 else f"{cid}_g{i}.jpg"
                storage_put(base, key, f"venue-photos/{fname}", img, "image/jpeg")
                urls.append(f"{base}/storage/v1/object/public/venue-photos/{fname}")
            except Exception as e:                  # noqa: BLE001
                log.warning("photo %d failed for %s: %s", i, hit["name"], e)

        try:
            sb(base, key, "clubs", method="POST", prefer="return=minimal", body={
                "id": cid,
                "name": hit["name"],
                "slug": slug,
                "address": hit["address"],
                "lat": hit["lat"],
                "lng": hit["lng"],
                "rating": hit["rating"],
                "ratings_total": hit["ratings_total"],
                "google_place_id": hit["id"],
                "cover_image_url": urls[0] if urls else None,
                "gallery_urls": urls[1:],
                "photos": urls,
                "is_active": True,
                "is_featured": False,
                "is_partner": False,
                "places_synced_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            })
        except urllib.error.HTTPError as e:
            log.error("insert failed for %s: %s %s", hit["name"], e.code, e.read()[:200])
            errors += 1; continue

        known_pid.add(hit["id"]); added += 1
        log.info("ADDED %-30s (%d photos, %d events)", hit["name"], len(urls), counts[v])
        time.sleep(0.1)                             # gentle on the Places quota

    log.info("done — added %d, not-a-club %d, already-known %d, errors %d",
             added, skipped_notclub, skipped_known, errors)
    return 0


if __name__ == "__main__":
    sys.exit(main())
