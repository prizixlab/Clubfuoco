# Brief: Loading Barcelona events into Supabase

**For:** whoever builds the events ingestion on the Club Fuoco / Supabase side.
**Written:** 2026-07-19. Self-contained — no prior conversation needed.

---

## TL;DR

A headless Ubuntu box ("agentbox", a repurposed Dell) sits on the LAN and scrapes
Resident Advisor every day. It maintains a **rolling, deduplicated calendar of
every Barcelona event for the next 14 days** (~190-330 events across ~85 venues).

The data is already clean and stable-keyed. Your job is to pull it and upsert it
into Supabase. **The one genuinely hard part is linking each event's venue to a
row in the `clubs` table — see "The venue matching problem" below.**

---

## 1. Where the data lives

| | |
|---|---|
| Host | `agentbox` at **`10.0.0.235`** (static IP, won't change) |
| SSH user | `yvinnik` (passwordless key already installed from Yakov's Mac) |
| Base dir | `/home/yvinnik/scraper/intel/events/` |

Files in that directory:

| File | What it is |
|---|---|
| **`upcoming.csv`** | **← use this.** Rolling forward calendar: every event from today to +14 days, deduplicated, soonest first. Regenerated daily. |
| `events.sqlite` | Source of truth. Table `events`, accumulates historically (~314 rows and growing), primary key = RA event id. |
| `YYYY-MM-DD.csv` / `.json` | Per-day snapshots of what was pulled that day. Historical, not needed for ingestion. |

---

## 2. How to access it automatically

**Preferred — SSH from the Mac (already authorised, no password):**

```bash
# copy the current calendar
scp yvinnik@10.0.0.235:/home/yvinnik/scraper/intel/events/upcoming.csv /tmp/

# or stream it without writing a file
ssh yvinnik@10.0.0.235 'cat ~/scraper/intel/events/upcoming.csv'

# or query the sqlite directly (richer, includes past events)
ssh yvinnik@10.0.0.235 \
  "sqlite3 -json ~/scraper/intel/events/events.sqlite \
   \"SELECT * FROM events WHERE date >= date('now') ORDER BY date\""
```

**Alternative — Finder/SMB share** (mounted as a normal network drive):
`smb://10.0.0.235/yvinnik` → `scraper/intel/events/` (user `yvinnik`).
Fine for eyeballing; use SSH for automation.

---

## 3. Data shape

### `upcoming.csv` columns

| Column | Notes |
|---|---|
| `ra_event_id` | **Stable natural key — upsert on this.** RA's event id, e.g. `2483653`. |
| `date` | `YYYY-MM-DD` (the listing date). |
| `start_time` | ISO timestamp, e.g. `2026-07-19T19:30:00.000`. Can be empty. |
| `title` | Event name. |
| `venue` | **Free-text venue name.** No id — see section 5. |
| `area` | Always `Barcelona`. |
| `promoters` | Pipe-separated: `"WAVES BARCELONA \| Loud-Contact"`. Can be empty. |
| `artists` | Pipe-separated. Can be empty. |
| `interested` | Int. RA interest count — grows over time, refreshed daily. |
| `attending` | Int. |
| `cost` | Free text/number, often `0` or empty. Not reliable pricing. |
| `ra_url` | `https://ra.co/events/<id>`. |
| `first_seen` | Date we first saw it → **use this to detect newly announced events**. |
| `last_seen` | Date last confirmed present on RA. |

### `events.sqlite` schema

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,   -- = ra_event_id
  title TEXT, date TEXT, start_time TEXT,
  venue TEXT, area TEXT, promoters TEXT, artists TEXT,
  interested INTEGER, attending INTEGER, cost TEXT, ra_url TEXT,
  first_seen TEXT, last_seen TEXT);
```

### Sample row

```
2491291, 2026-07-19, 2026-07-19T19:30:00.000,
"WAVES X AZUL ROOFTOP - FIFA WORLD CUP 2026 FINAL EDITION",
Azul Rooftop Barceloneta, Barcelona, WAVES BARCELONA, NIIXII,
44, 44, 0, https://ra.co/events/2491291, 2026-07-17, 2026-07-17
```

---

## 4. Update cadence & guarantees

- **Refreshed daily at 08:00 UTC.** A worker also runs every 30 min but only
  touches promoter data, not events.
- **Deduplicated by RA event id** — an event seen on ten consecutive nights
  appears exactly once. Verified: a second run in the same day inserts 0 new rows.
- **Counts are updated** (`interested`/`attending` grow) while `first_seen` stays fixed.
- **Rolling window:** past events drop out of `upcoming.csv` automatically. They
  remain in `events.sqlite` if you want history.
- Source is RA's paginated `eventListings` GraphQL — the same feed ra.co's own
  listings page uses, so coverage spans commercial clubs (Opium, Ku, La Terrrazza,
  Noxe, Macarena) as well as underground venues, not just techno.

---

## 5. ⚠️ The venue matching problem (the real work)

Events carry a **venue name string only** — no id linking to `clubs`. Measured
against the live DB today:

- 63 distinct venues in the calendar
- **14 match a `clubs.name` exactly** (after lowercasing/stripping accents+punctuation)
- **49 do not match** — e.g. `Almar Beach Club`, `Azul Rooftop Barceloneta`,
  `Bikini Club`, `BORIS CLUB`, `7833 Soundlab`, `Bonavista Rooftop`
- Of the 14 that match, 11 are already `is_active = true`

Also relevant: `clubs` has **1,683 rows** (358 active, 1,325 inactive), seeded from
Google Places, so it contains many restaurants/cafés. There *is* a `ra_venue_slug`
column but it is **0% populated** — nothing to join on yet.

**Options, roughly in order of sanity:**

1. **Store `venue_name` as text on the event row now, resolve later.** Ship
   ingestion immediately, add `club_id` as a nullable FK, backfill as matches improve.
2. **Fuzzy match** (normalise case/accents/punctuation, then token or trigram
   similarity) with a confidence threshold; queue low-confidence ones for review.
3. **Populate `clubs.ra_venue_slug`** and join on it properly — the durable fix,
   but someone has to map them once.
4. **Auto-create missing venues** — do this cautiously; it would add ~49 new club
   rows of unknown quality to an already noisy table.

Recommended: (1) now, then (3) as the durable fix.

---

## 6. Suggested target design

```sql
create table if not exists public.events (
  ra_event_id   text primary key,
  title         text not null,
  date          date not null,
  start_time    timestamptz,
  venue_name    text not null,          -- raw string from RA
  club_id       uuid references public.clubs(id),  -- nullable until resolved
  promoters     text[],                 -- split the pipe-separated field
  artists       text[],
  interested    int default 0,
  attending     int default 0,
  cost          text,
  ra_url        text,
  first_seen    date,
  last_seen     date,
  updated_at    timestamptz default now()
);
create index on public.events (date);
create index on public.events (club_id);
```

Ingestion = `upsert on conflict (ra_event_id) do update` for title/date/counts/
`last_seen`. Never overwrite `first_seen`.

### ⚠️ This must be SCHEDULED, not run by hand

The source on the Dell refreshes itself daily. **Supabase will not.** A one-off
import script leaves the events table stale within days — new events are announced
constantly and `interested` counts move every day.

Whatever you build needs a recurring trigger. Options:

| Approach | Notes |
|---|---|
| **Dell pushes** (see §8) | Simplest. The daily job already runs and already holds the service key — one scheduler instead of two. |
| Supabase Edge Function + `pg_cron` | Runs in your infra, but must reach the Dell on the LAN — usually a blocker. |
| Vercel Cron / GitHub Action | Same LAN reachability problem unless the Dell is exposed or pushes outward. |
| Mac-side `launchd` | Works, but only while Yakov's Mac is awake and on the network. |

**Reachability matters:** `10.0.0.235` is a LAN address. Anything hosted in the
cloud *cannot pull from it*. That rules out most pull-based options and is the main
argument for the Dell pushing outward instead (§8).

Run it at least daily, ideally shortly after **08:15 UTC** (once the Dell's refresh
has finished).

---

## 7. Gotchas

- **Encoding:** CSVs are written **UTF-8 with BOM** (`utf-8-sig`). Read with
  `encoding="utf-8-sig"` or your first column name will come through as
  `﻿ra_event_id`. (The BOM is deliberate — without it Excel/Numbers mangle
  accents like `Círculo` and `Jansøund`.)
- **Pipe-separated multi-values:** split `promoters`/`artists` on `" | "`.
- **`cost` is unreliable** — often `0` or blank. Don't surface it as a price.
- **Times:** `date` is the listing date; `start_time` may be empty, and late events
  can start after midnight, so don't assume `start_time::date == date`.
- **Don't delete events that vanish** from `upcoming.csv` — they've usually just
  aged past the 14-day window, not been cancelled. Use `last_seen` to judge.

---

## 8. Alternative worth considering

The Dell **already holds the Supabase service-role key** (it writes venue pitches
into `clubs.description` nightly). So instead of pulling from the Dell, the Dell
could **push events straight into Supabase** at the end of its daily run — no
transfer step, no scheduling on the app side.

If that's preferable, say so and it can be built there instead. The reason it
wasn't done already is that the Supabase-side schema and venue-resolution
decisions above belong to whoever owns the app.

---

## 9. Related context (available if useful)

The same box also maintains, in `/home/yvinnik/scraper/intel/`:

- `promoters/promoters.csv` — Barcelona promoters ranked by Instagram followers,
  with IG follower/following/ratio, email, website, the clubs they hold guest-list
  agreements with, and free-guestlist / VIP flags.
- `curation/recommend_activate.csv`, `recommend_remove.csv`, `not_nightlife.csv` —
  advisory sheets on which `clubs` rows to switch on, remove, or exclude as
  non-nightlife (venue type classified by a local LLM).

Status of everything: `ssh yvinnik@10.0.0.235 '~/scraper/check.py'`
