#!/usr/bin/env python3
"""
Backfill cover photos for venues that are is_active but invisible in the app.

Why this exists
---------------
getNearbyClubs() ends with `.filter(place => place.photos.length > 0)`, and
isUsablePhoto() rejects any maps.googleapis.com / /api/places/photo URL. So a
venue with only Google Places imagery counts as photoless and never reaches the
feed. This fills the gap with CC-licensed images we are allowed to store.

Source: Openverse (https://api.openverse.org) - no API key, aggregates Flickr /
Wikimedia. We request license=cc0,pdm,by and license_type=commercial only.
BY requires attribution, so we record creator + license + source per photo in
photo_credits.json next to this script. Keep that file - it is the licence trail.

Storage: Supabase `venue-photos` bucket, public, keyed {club_id}.jpg to match the
existing convention.

Usage
-----
  python3 scripts/backfill-venue-photos.py --dry-run          # show plan only
  python3 scripts/backfill-venue-photos.py --limit 10         # do 10
  python3 scripts/backfill-venue-photos.py                    # do all hidden

These are generic nightlife stock images, NOT photos of the venue. They exist to
clear the photo gate so a venue is reachable. Replace with venue-supplied
photography as it arrives - especially for venues carrying live partner_offers.
"""
import argparse, json, os, sys, urllib.parse, urllib.request, ssl

# python.org Python on macOS ships without the system cert store, so every
# https call raises CERTIFICATE_VERIFY_FAILED. Use certifi's bundle explicitly.
try:
    import certifi
    SSLCTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSLCTX = ssl.create_default_context()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREDITS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'photo_credits.json')

def env():
    url = key = None
    with open(os.path.join(ROOT, '.env.local')) as f:
        for line in f:
            if line.startswith('NEXT_PUBLIC_SUPABASE_URL='):  url = line.split('=', 1)[1].strip()
            if line.startswith('SUPABASE_SERVICE_ROLE_KEY='): key = line.split('=', 1)[1].strip()
    if not url or not key:
        sys.exit('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
    return url, key

def req(url, key, path, method='GET', body=None, headers=None, raw=False):
    h = {'apikey': key, 'Authorization': f'Bearer {key}'}
    h.update(headers or {})
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    if body is not None and not raw:
        h['Content-Type'] = 'application/json'
    r = urllib.request.Request(url + path, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, context=SSLCTX) as resp:
        return resp.read()

def usable(u):
    return bool(u) and 'maps.googleapis.com/maps/api/place/photo' not in u and '/api/places/photo' not in u

def has_usable(c):
    imgs = ([c.get('cover_image_url')] if c.get('cover_image_url') else []) \
         + (c.get('photos') or []) + (c.get('gallery_urls') or [])
    return any(usable(x) for x in imgs if isinstance(x, str))

# Pick search terms from the venue's own genres/name so the image at least
# matches the room type (techno cellar vs cocktail bar vs beach club).
#
# Each category is a LIST, tried in order. Long multi-word phrases match very
# few CC images ("bar nightlife interior" has 66 results, "bar interior" has
# 240), and since we never reuse an image across venues a single narrow term
# drains after ~20 venues. Several broad terms per category keeps the pool deep.
def query_for(club):
    name = (club.get('name') or '').lower()
    gen  = ' '.join(club.get('music_genres') or []).lower()
    blob = f'{name} {gen}'
    for kws, qs in [
        (('techno', 'electronic', 'house', 'rave', 'disco', 'club'),
         ['nightclub', 'disco', 'dj club', 'dance club', 'concert lights', 'dj booth']),
        (('jazz', 'blues', 'live music', 'jam'),
         ['jazz club', 'live music venue', 'jazz band', 'music stage']),
        (('flamenco', 'tablao'),
         ['flamenco', 'flamenco dancer', 'music stage']),
        (('beach', 'chiringuito', 'terraza', 'terrace', 'rooftop', 'sky'),
         ['rooftop bar', 'rooftop terrace', 'terrace night', 'city night view']),
        (('cocktail', 'gin', 'coctel', 'speakeasy', 'whisk', 'vermut'),
         ['cocktail bar', 'cocktail', 'bartender', 'speakeasy', 'bar counter']),
        (('shisha', 'lounge', 'hookah'),
         ['lounge bar', 'hookah lounge', 'lounge interior', 'bar lounge']),
    ]:
        if any(k in blob for k in kws):
            return qs
    return ['bar interior', 'pub interior', 'bar counter', 'night bar', 'tavern interior', 'pub']

def openverse(qs, seen, need=1, _cache={}):
    """Return up to `need` unused CC images, trying each term in `qs` in turn."""
    out = []
    for q in (qs if isinstance(qs, list) else [qs]):
        if len(out) >= need:
            break
        out += _openverse_one(q, seen, need - len(out), _cache)
    return out

def _openverse_one(q, seen, need, _cache):
    """Up to `need` unused CC images for a single query `q`.

    A 20-result page runs dry fast once `seen` grows, so page through and cache
    per-term position so each venue draws fresh images.
    """
    out = []
    page = _cache.get(q, {}).get('page', 0)
    pool = _cache.get(q, {}).get('pool', [])
    while len(out) < need:
        pool = [r for r in pool if r['url'] not in seen]
        while pool and len(out) < need:
            r = pool.pop(0)
            seen.add(r['url'])          # claim it immediately
            out.append(r)
        if len(out) >= need:
            break
        page += 1
        if page > 12:                   # exhausted this term
            break
        u = ('https://api.openverse.org/v1/images/?q=' + urllib.parse.quote(q) +
             f'&license=cc0,pdm,by&license_type=commercial&page_size=20&page={page}&mature=false')
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request(
                u, headers={'User-Agent': 'ClubFuoco/1.0'}), context=SSLCTX).read())
        except Exception as e:
            print(f'    openverse error (page {page}): {e}')
            break
        res = [r for r in d.get('results', [])
               if r['url'].lower().endswith(('.jpg', '.jpeg', '.png')) and r['url'] not in seen]
        if not res and not d.get('results'):
            break
        pool += res
    _cache[q] = {'page': page, 'pool': pool}
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--gallery', type=int, default=2,
                    help='gallery photos in addition to the cover (default 2)')
    ap.add_argument('--club-id', action='append', default=[],
                    help='also top up this club even if it already has a cover; repeatable')
    a = ap.parse_args()

    url, key = env()
    clubs, off = [], 0
    while True:
        b = json.loads(req(url, key,
            f'/rest/v1/clubs?select=id,name,is_active,cover_image_url,photos,gallery_urls,music_genres'
            f'&is_active=eq.true&limit=1000&offset={off}'))
        if not b: break
        clubs += b
        if len(b) < 1000: break
        off += 1000

    target = 1 + a.gallery                       # cover + gallery
    todo = [c for c in clubs if not has_usable(c)]
    if a.limit: todo = todo[:a.limit]
    # --club-id venues are topped up even though they already have a cover.
    ids = {c['id'] for c in todo}
    for cid in a.club_id:
        extra = next((c for c in clubs if c['id'] == cid), None)
        if extra and extra['id'] not in ids:
            todo.append(extra); ids.add(extra['id'])
        elif not extra:
            print(f'  warn: --club-id {cid} not found among active clubs')
    print(f'active={len(clubs)}  to process={len(todo)}  target={target} photos each\n')

    credits = json.load(open(CREDITS)) if os.path.exists(CREDITS) else {}
    seen = {u for v in credits.values() for u in v.get('source_urls', [])}
    done = fail = 0

    for c in todo:
        q = query_for(c)
        # count what it already has so we only fetch the shortfall
        have = [x for x in ([c.get('cover_image_url')] if c.get('cover_image_url') else [])
                + (c.get('gallery_urls') or []) if isinstance(x, str) and usable(x)]
        need = max(0, target - len(have))
        print(f"  {c['name'][:38]:<40} q={q[0]}.. have={len(have)} need={need}")
        if a.dry_run or need == 0:
            continue

        hits = openverse(q, seen, need)
        if not hits:
            print('    no results'); fail += 1; continue

        uploaded, meta = [], []
        for i, hit in enumerate(hits):
            # slot 1 is the cover ({id}.jpg); gallery continues _2, _3, ...
            slot = len(have) + i + 1
            suffix = '' if slot == 1 else f'_{slot}'
            try:
                img = urllib.request.urlopen(urllib.request.Request(
                    hit['url'], headers={'User-Agent': 'ClubFuoco/1.0'}), timeout=30, context=SSLCTX).read()
            except Exception as e:
                print(f'    download failed: {e}'); continue
            ext = 'png' if hit['url'].lower().endswith('.png') else 'jpg'
            try:
                req(url, key, f'/storage/v1/object/venue-photos/{c["id"]}{suffix}.{ext}', 'POST', img,
                    {'Content-Type': f'image/{ext}', 'x-upsert': 'true'}, raw=True)
            except Exception as e:
                print(f'    upload failed: {e}'); continue
            uploaded.append(f'{url}/storage/v1/object/public/venue-photos/{c["id"]}{suffix}.{ext}')
            meta.append(hit)

        if not uploaded:
            fail += 1; continue

        # first usable image is the cover, the rest land in gallery_urls
        allp = have + uploaded
        patch = {'cover_image_url': allp[0], 'gallery_urls': allp[1:]}
        req(url, key, f'/rest/v1/clubs?id=eq.{c["id"]}', 'PATCH', patch)

        prev = credits.get(c['id'], {})
        credits[c['id']] = {
            'club': c['name'],
            'source_urls': prev.get('source_urls', []) + [h['url'] for h in meta],
            'attribution': prev.get('attribution', []) + [
                {'license': f"{h.get('license','').upper()} {h.get('license_version','')}".strip(),
                 'creator': h.get('creator'), 'title': h.get('title'),
                 'source': h.get('foreign_landing_url')} for h in meta],
        }
        json.dump(credits, open(CREDITS, 'w'), indent=2)
        print(f'    ok  +{len(uploaded)} photo(s)  [{", ".join((h.get("license") or "").upper() for h in meta)}]')
        done += 1

    print(f'\ndone={done} failed={fail}')
    if not a.dry_run:
        print(f'credits -> {CREDITS}')

if __name__ == '__main__':
    main()
