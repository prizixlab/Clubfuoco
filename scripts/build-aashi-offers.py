#!/usr/bin/env python3
"""Turn the scraped Aashi List calendar into partner_offers rows.

    python3 scripts/build-aashi-offers.py       # writes scripts/out/aashi_offers.json

Reads data/suppliers/aashi/offers-by-day.json (barcelonaclubs.com, scraped
2026-07-11) and collapses it to one offer per (venue, entry type) with a
canonical valid_days list.

Decisions worth knowing, because they are judgement calls not mechanics:

  * Only cta_type == 'guestlist' rows are imported. 'tickets' rows are external
    paid ticketing we cannot fulfil, so importing them would advertise
    something we can't deliver.
  * "Discount Entrance" nights become a SEPARATE offer titled "Discount Entry",
    never folded into "Free Guestlist". Opium is free on Monday and discounted
    the rest of the week — one combined offer would promise free entry on
    nights that charge.
  * The slug -> clubs.id map below is hand verified by name AND address. Fuzzy
    matching produced confident nonsense here (hotel-w-noxe matched "Slow
    Barcelona"), so anything unconfirmed is skipped rather than guessed.
  * Buckets key on club_id, not slug: the feed uses two slugs (downtown,
    downtownbarcelona) for one venue, which would otherwise create two
    competing offers for the same club.
"""

import json, collections, re, pathlib
d = json.load(open('data/suppliers/aashi/offers-by-day.json'))

# Hand-verified slug -> clubs.id. Only mappings I could confirm by name AND
# address; anything ambiguous is deliberately excluded (see SKIPPED below).
MAP = {
 'bling-bling-barcelona': ('07ce6a58-ceee-48e4-89ce-3c3e6b6ff2b2', 'Bling Bling Barcelona'),
 'cdlc-carpe-diem-lounge-club-barcelona': ('d649395c-d3db-4397-b200-42b575d1738a', 'CDLC Barcelona'),
 'colors-barcelona': ('b635bfba-36ea-4914-a3c7-420bdb704323', 'Colors Club Barcelona'),
 'downtown': ('60d6f94e-26cc-4d24-bacc-8a255e1c7924', 'Downtown Barcelona'),
 'downtownbarcelona': ('60d6f94e-26cc-4d24-bacc-8a255e1c7924', 'Downtown Barcelona'),
 'jamboree-barcelona': ('a83428e5-5c7f-4f55-99e5-3f329f7c3210', 'Jamboree'),
 'la-biblio-bcn': ('1a49859c-ebcf-417a-b025-3dd84bcb1d54', 'La Biblio'),
 'opium-barcelona': ('b3f7747f-d911-490d-a688-d04add6a1c8b', 'Opium Barcelona'),
 'ovella-negra': ('acfe5fb3-707b-4dde-8ca7-95a416a415a2', "L'Ovella Negra"),
 'pacha-barcelona': ('d184f2f1-8db3-4d03-ae11-ad19b650894d', 'Ku (formerly Pacha)'),
 'shoko-barcelona': ('ddca5d10-9b4f-47c4-81a2-2c36bef77e49', 'Shôko'),
 'sutton-barcelona': ('e0cf6310-28e5-4117-ad5f-01179f87d8fd', 'Sutton Club Barcelona'),
 'twenties': ('3c3716e0-0361-4a62-b4d2-ec1eb5d00bbb', 'Twenties Barcelona'),
}
SKIPPED = {'hotel-w-noxe':'no matching club row', 'wet-deck-pool-hotel-w':'no matching club row',
           'rito-barcelona':'no matching club row',
           'la-fira-group1':'multi-venue group offer', 'lafira-villarroel':'multi-venue group offer'}

ABBR = {'monday':'Mon','tuesday':'Tue','wednesday':'Wed','thursday':'Thu',
        'friday':'Fri','saturday':'Sat','sunday':'Sun'}
ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

def window(s):
    if not s: return None
    m = re.findall(r'(\d{1,2})[.:]?(\d{2})?\s*h', s)
    if len(m) != 2: return None
    fmt = lambda t: f"{int(t[0]):02d}:{t[1] or '00'}"
    return f"{fmt(m[0])} – {fmt(m[1])}"

buckets = collections.defaultdict(lambda: collections.defaultdict(list))
for day, rows in d['days'].items():
    for r in rows:
        if r.get('cta_type') != 'guestlist': continue
        slug = r['venue_slug']
        if slug not in MAP: continue
        ent = (r.get('entrance') or '').lower()
        if 'free entrance' in ent:   kind = 'free'
        elif 'discount' in ent:      kind = 'discount'
        else:                        continue          # e.g. "Online Tickets" — not ours to sell
        buckets[MAP[slug][0]][kind].append((ABBR[day], r))

offers = []
for club_id, kinds in buckets.items():
    club_name = next(v[1] for v in MAP.values() if v[0] == club_id)
    for kind, entries in kinds.items():
        days = sorted({e[0] for e in entries}, key=ORDER.index)
        ents = collections.Counter((e[1].get('entrance') or '').strip() for e in entries)
        wins = collections.Counter(w for w in (window(e[1].get('schedule')) for e in entries) if w)
        musics = collections.Counter(m for m in ((e[1].get('music') or '').strip() for e in entries) if m)
        offers.append({
            'club_id': club_id, '_club': club_name,
            'kind': 'free_guestlist',
            'title': 'Free Guestlist' if kind == 'free' else 'Discount Entry',
            'subtitle': ents.most_common(1)[0][0] if ents else ('Free entry' if kind=='free' else 'Discounted entry'),
            'price_eur': None, 'party_size': None,
            'time_window': wins.most_common(1)[0][0] if wins else 'Door open till closing',
            'valid_days': ', '.join(days),
            'dress_code': 'Smart casual',
            'music': musics.most_common(1)[0][0] if musics else '',
            'skipped_dates': [],
        })

offers.sort(key=lambda o: (o['_club'], o['title']))
pathlib.Path('scripts/out').mkdir(parents=True, exist_ok=True)
json.dump(offers, open('scripts/out/aashi_offers.json','w'), ensure_ascii=False, indent=1)
print(f"{len(offers)} offers across {len({o['club_id'] for o in offers})} venues\n")
for o in offers:
    print(f"  {o['_club'][:24]:26s} {o['title']:16s} {o['valid_days']:28s} {o['time_window']:16s} {o['subtitle'][:34]}")
print("\nSKIPPED:")
for s, why in SKIPPED.items(): print(f"  {s:24s} {why}")
