#!/usr/bin/env python3
"""
Host Google Places photos for active clubs that have no usable photo.

Why: a club whose `photos` hold only raw Google photo references (or proxy
URLs) has nothing the apps can display — iOS drops non-http entries, the web
rejects /api/places/photo — so the club page shows a placeholder. This mirrors
up to 3 of the place's photos into the `venue-photos` bucket using the same
naming as scripts/agentbox/ingest_venues.py ({id}.jpg, {id}_g1.jpg, …) and
points cover_image_url / gallery_urls / photos at them.

Usage
-----
  python3 scripts/host-club-photos.py --dry-run     # list what would change
  python3 scripts/host-club-photos.py               # do it
"""
import json, os, ssl, sys, urllib.parse, urllib.request

try:
    import certifi
    SSLCTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSLCTX = ssl.create_default_context()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACES_NEW = 'https://places.googleapis.com/v1'
MAX_PHOTOS = 3


def env():
    vals = {}
    with open(os.path.join(ROOT, '.env.local')) as f:
        for line in f:
            k, _, v = line.strip().partition('=')
            if k in ('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_PLACES_API_KEY'):
                vals[k] = v.strip().strip('"')
    return vals['NEXT_PUBLIC_SUPABASE_URL'], vals['SUPABASE_SERVICE_ROLE_KEY'], vals['GOOGLE_PLACES_API_KEY']


def http(url, method='GET', body=None, headers=None):
    r = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    with urllib.request.urlopen(r, context=SSLCTX, timeout=30) as resp:
        return resp.read()


def usable(u):
    return isinstance(u, str) and u.startswith('http') \
        and 'place/photo' not in u and '/api/places/photo' not in u


def main():
    dry = '--dry-run' in sys.argv
    base, key, pkey = env()
    auth = {'apikey': key, 'Authorization': f'Bearer {key}'}
    clubs = json.loads(http(
        f'{base}/rest/v1/clubs?select=id,name,google_place_id,cover_image_url,photos,gallery_urls'
        f'&is_active=eq.true&limit=5000', headers=auth))
    todo = [c for c in clubs if not any(usable(u) for u in
            [c['cover_image_url']] + (c['photos'] or []) + (c['gallery_urls'] or []))]
    print(f'{len(todo)} active clubs without a usable photo')

    done = 0
    for c in todo:
        cid, name, pid = c['id'], c['name'], c['google_place_id']
        if not pid:
            print(f'  skip  {name}: no google_place_id'); continue
        try:
            place = json.loads(http(f'{PLACES_NEW}/places/{pid}',
                                    headers={'X-Goog-Api-Key': pkey, 'X-Goog-FieldMask': 'photos'}))
        except Exception as e:  # noqa: BLE001
            print(f'  fail  {name}: place lookup {e}'); continue
        names = [p['name'] for p in place.get('photos', [])[:MAX_PHOTOS]]
        if not names:
            print(f'  skip  {name}: Google has no photos'); continue
        if dry:
            print(f'  would host {len(names)} for {name}'); continue

        urls = []
        for i, pn in enumerate(names):
            try:
                img = http(f'{PLACES_NEW}/{pn}/media?maxWidthPx=800&key={pkey}')
                fname = f'{cid}.jpg' if i == 0 else f'{cid}_g{i}.jpg'
                http(f'{base}/storage/v1/object/venue-photos/{fname}', method='POST', body=img,
                     headers={**auth, 'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
                urls.append(f'{base}/storage/v1/object/public/venue-photos/{fname}')
            except Exception as e:  # noqa: BLE001
                print(f'        photo {i} failed for {name}: {e}')
        if not urls:
            print(f'  fail  {name}: no photo uploaded'); continue
        http(f'{base}/rest/v1/clubs?id=eq.{cid}', method='PATCH',
             body=json.dumps({'cover_image_url': urls[0], 'gallery_urls': urls[1:], 'photos': urls}).encode(),
             headers={**auth, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
        done += 1
        print(f'  ok    {name}: {len(urls)} photos')
    if not dry:
        print(f'hosted photos for {done}/{len(todo)}')


if __name__ == '__main__':
    main()
