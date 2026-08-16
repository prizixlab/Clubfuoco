# Brief: Loading Barcelona DJs / artists into Supabase

**For:** whoever builds the DJ ingestion on the Club Fuoco / Supabase side.
**Written:** 2026-07-29. Self-contained — no prior conversation needed.
**Companion doc:** `EVENTS_INGEST_BRIEF.md` (events). DJs and events are linked —
see §5.

---

## TL;DR

The same headless box ("agentbox", a Dell on the LAN) that scrapes events also
maintains a growing, deduplicated table of **Barcelona DJs / artists** pulled
from Resident Advisor — currently **~1,286 DJs, all enriched** with social
links, RA follower counts, most-played venues/regions, genres, and **profile
images**. Your job is to pull it and upsert it into Supabase.

Unlike the promoter data, this is **RA-only** (no Instagram scraping), so it has
no rate-limit gaps — every row is fully populated.

---

## 1. Where the data lives

| | |
|---|---|
| Host | `agentbox` — `10.0.0.235` (home LAN) or `100.125.231.19` (Tailscale, anywhere) |
| SSH user | `yvinnik` (passwordless key already installed from Yakov's Mac) |
| Files | `/home/yvinnik/scraper/intel/events/` |

| File | What it is |
|---|---|
| **`djs.csv`** | **← use this.** All DJs, ranked by RA followers. Regenerated every run. |
| `djs.sqlite` | Source of truth. Table `djs`, primary key = RA artist id. Richer than the CSV (has a couple of internal columns). |

Pull it:
```bash
scp yvinnik@10.0.0.235:/home/yvinnik/scraper/intel/events/djs.csv ./
# or query the sqlite directly:
ssh yvinnik@10.0.0.235 \
  "python3 -c 'import sqlite3,json;print(json.dumps([dict(zip([c[0] for c in x.description],r)) for x in [sqlite3.connect(\"/home/yvinnik/scraper/intel/events/djs.sqlite\").execute(\"SELECT * FROM djs\")] for r in x]))'"
```

---

## 2. `djs.csv` columns

| Column | Notes |
|---|---|
| `rank` | Row number, by RA followers desc. Not stable — don't key on it. |
| `name` | DJ / artist name. |
| `ra_followers` | RA follower count. Main popularity signal. |
| `genres` | Pipe-joined, derived from the events they play (e.g. `Techno \| House`). |
| `instagram_handle` | e.g. `pawsa` (no @). Blank if RA doesn't list one. |
| `instagram_url` | Full URL as RA stores it. |
| `soundcloud_samples` | SoundCloud profile URL — this is the closest thing to a "set list / samples" (we can't host audio). |
| `website` | Personal site if any. |
| `bandcamp` | Bandcamp URL if any. |
| `discogs` | Discogs URL if any. |
| `known_venues` | Pipe-joined venues they play most (e.g. `Nitsa \| LAUT`). |
| `regions_played` | Pipe-joined, most-played first. Barcelona is prominent for these DJs by design (see §4). |
| `bcn_events_seen` | How many Barcelona events we've seen them on. Local-relevance signal. |
| `ra_url` | `https://ra.co/dj/<slug>`. |
| **`image_url`** | **Square profile photo** (RA CDN, `static.ra.co`). See §3. |
| **`cover_image_url`** | **Larger banner / performance shot** (RA CDN). Sometimes blank. |
| `first_seen` | When we first added them. |
| `last_enriched` | Last RA refresh date. |

**The stable natural key is the RA artist id.** It is the `djs.sqlite` primary
key (`ra_id`) and is embedded in `ra_url` (`ra.co/dj/<slug>` — but the numeric
id in sqlite is the real key). If you want it as a column in the CSV too, say so
and it can be added — right now you'd join on `ra_url` or `name`+`ra_url`.

---

## 3. DJ IMAGES  (Yakov asked specifically)

RA exposes two images per artist, both on their CDN (`static.ra.co`):

- **`image_url`** — square profile photo. This is what RA shows as the artist's
  avatar. Example: `https://static.ra.co/images/profiles/square/pawsa.jpg?dateUpdated=...`
- **`cover_image_url`** — larger image (`/profiles/lg/...` or `/profiles/<slug>.jpg`),
  often a wider promo/performance shot. Not always present.

Notes for your side:
- These are **hot-links to RA's CDN**, not files we host. They load fine in a
  browser/`<img>` today, but if you want them to survive long-term you should
  **download and re-host them in Supabase Storage** (a bucket) and store your own
  URL — RA could change or expire the CDN paths.
- The `?dateUpdated=` query param is a cache-buster; keep the whole URL.
- There is **no dedicated "live performance" photo** in RA's data — `image`
  (avatar) and `coverImage` (banner) are all they expose. A true action shot
  would need a different source (Instagram, press kits) and isn't available here.
- **Coverage:** as of writing, images are being backfilled across all ~1,286
  DJs. Top DJs already have them; the long tail fills in over a short while. If a
  row's `image_url` is blank, the DJ simply had no photo on RA.

---

## 4. What "Barcelona DJ" means here (scope)

Two ways a DJ enters the table (`source` column in sqlite: `event` or `related`):

1. **`event`** (~1,135) — they appear on the lineup of an actual Barcelona event
   (upcoming OR in the last ~60 days). Barcelona-relevant by definition.
2. **`related`** (~151) — found by crawling RA's "related artists" graph outward
   from known DJs, and kept ONLY if **Barcelona is one of their top-3 most-played
   regions**. This keeps the list to DJs genuinely rooted in Barcelona, not
   globe-trotters who played one gig.

The list **keeps growing on its own** (every 30 min while productive, then a
weekly deep sweep once it plateaus), so treat ingestion as **recurring, not
one-off** — same as events (see §6).

---

## 5. Linking DJs to EVENTS (important)

The events feed (`upcoming.csv` / `events.sqlite`, see `EVENTS_INGEST_BRIEF.md`)
has an **`artists`** field per event: a pipe-joined list of DJ **names** playing
that night. That's the DJ↔event link — a DJ's "set" at a venue.

- To connect them in Supabase: match event `artists` names against `djs.name`.
  It's name-based (same soft-match caveat as venue linking in the events brief),
  so consider storing the raw names on the event and resolving `dj_id` FKs after.
- **Caveat — genre-only "events":** some RA listings have an EMPTY artists list
  and only genre tags (e.g. Downtown's weekly "reggaeton / hip-hop / commercial"
  night). Those are a venue's recurring format, not a curated DJ set. Yakov asked
  that these be treated as a **separate "set list" category, not real events** —
  that split is noted but **not yet implemented** in the pipeline. Flagging it so
  you don't ingest format-nights as artist-driven events. Ask if you want this
  done before ingestion.

---

## 6. Update cadence & guarantees

- **Refreshed continuously**: enrichment + discovery run every 30 min; a full
  harvest (incl. past events) runs daily at 08:00 UTC.
- **Deduplicated by RA artist id** — a DJ appearing on many events is one row.
- **Counts/links refresh**; `first_seen` stays fixed.
- **RA-only, so no rate-limit holes** — every row is fully enriched, unlike the
  Instagram-limited promoter data.
- Ranked by `ra_followers` (desc), so the top of the file is the most relevant;
  the long tail is the wide Barcelona net.

**Must be SCHEDULED, not run once** — see the events brief §"This must be
SCHEDULED". Same reachability rule: `10.0.0.235`/`100.125.231.19` are private;
a cloud function can't pull from them. The clean option is the Dell **pushing**
into Supabase (it already holds the service key). Say the word and it can be
built there.

---

## 7. Suggested target design

```sql
create table if not exists public.djs (
  ra_artist_id   text primary key,      -- from djs.sqlite ra_id
  name           text not null,
  ra_followers   int default 0,
  genres         text[],                -- split the pipe field
  instagram      text,
  soundcloud     text,                  -- "samples"
  website        text,
  bandcamp       text,
  discogs        text,
  known_venues   text[],
  regions        text[],
  bcn_events_seen int default 0,
  ra_url         text,
  image_url      text,                  -- consider re-hosting in Storage
  cover_image_url text,
  first_seen     date,
  last_enriched  date,
  updated_at     timestamptz default now()
);

-- link table once event artists are resolved to djs
create table if not exists public.event_djs (
  ra_event_id text references public.events(ra_event_id),
  ra_artist_id text references public.djs(ra_artist_id),
  primary key (ra_event_id, ra_artist_id)
);
```

Ingestion = `upsert on conflict (ra_artist_id)`. Never overwrite `first_seen`.

---

## 8. Gotchas

- **Encoding:** CSV is **UTF-8 with BOM** (`utf-8-sig`). Read with
  `encoding="utf-8-sig"` or the first column header comes through as `﻿rank`.
- **Pipe-separated** multi-value fields (`genres`, `known_venues`,
  `regions_played`): split on `" | "`.
- **Images are hot-links to RA's CDN** — re-host if you need permanence (§3).
- **`rank` is not a key** — it renumbers every refresh. Key on the RA artist id.
- **Name collisions**: two artists can share a name; the RA id disambiguates, so
  prefer id-based joins over name-based where possible.
- Don't delete DJs that stop appearing — they just aren't currently booked.

---

## 9. DJ timelines — `dj_appearances` (added 2026-08-15)

The app shows each DJ's **own** upcoming run, and never links out to Resident
Advisor for it. `public.events` cannot supply that: it is filtered to Barcelona
(`areas: {eq: BCN_AREA_ID}`), so a resident playing Berlin next Friday reads as
a gap rather than as a working artist.

`scripts/agentbox/dj_appearances.py` fills the gap using RA's **`Artist.events`**,
which is per-artist and *not* area-filtered, and upserts into
`public.dj_appearances` (migration `20260815_dj_appearances.sql`).

| | |
|---|---|
| Horizon | 120 days |
| Ordering | every **featured** DJ first (`club_dj_sets`), then most-followed |
| `club_id` | set only when the venue name matches one of our active clubs **exactly** (normalised) |

Two rules worth keeping:

- **`club_id` uses an exact normalised match, not the fuzzy venue matcher.** A
  wrong id here would make an away night look bookable and send someone to the
  wrong door. Unmatched is the safe state — the app renders those as
  "«City» is coming soon" rather than a dead link.
- **`ra_artist_id` is a FK onto `djs`.** The box's catalogue runs ahead of
  Supabase, so appearances for an artist not yet pushed are skipped (and logged)
  rather than failing the batch; the next run picks them up.

### Cron slot

Ordering is load-bearing — it must run after `push_djs.py` (the FK target) and
after `link_djs.py` (which creates the featured slots it prioritises):

    00:08  nightly_research.py full
    15:08  push_events.py
    20:08  push_djs.py
    25:08  link_djs.py
    30:08  dj_appearances.py     ← here

---

## 10. Status of everything on the box

    ssh yvinnik@10.0.0.235 '~/scraper/check.py'
