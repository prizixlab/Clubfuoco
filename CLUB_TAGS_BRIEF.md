# Club search tags — how they work & how to search them

**What:** every active club now gets a controlled set of **searchable tags** in
`public.clubs.tags` (Postgres `text[]`), so the app can filter venues by genre,
rooftop, VIP tables, area, etc. Generated + refreshed nightly on **agentbox**.
**Created:** 2026-09-08.  **Script:** `~/scraper/tag_clubs.py`.

---

## Where the tags live
- **`clubs.tags text[]`** in Supabase (added via `ALTER TABLE`, GIN-indexed).
- Local mirror for review: `~/scraper/intel/tags/club_tags.csv` (+ `.sqlite`),
  columns: name, active, tag_count, tags, last_tagged.
- Refreshed **daily 08:40 UTC** (cron), after the RA harvest + push chain so
  genre data is current. Re-run by hand: `ssh agentbox 'cd ~/scraper &&
  ./venv/bin/python3 tag_clubs.py active'` (`all` = every venue, `dryrun` = no push).

## How tags are derived (trust order)
1. **Genre** — *factual, from your own RA data*: the genres of events + DJs
   actually booked at that venue (events.sqlite / djs.sqlite), matched by
   **exact normalised venue name** (precision over recall — a wrong genre on a
   tapas bar is worse than a missing one). Plus the `music_genres` column.
2. **Space / experience** — keyword-anchored on the venue name + review text
   (English + Spanish), and structured columns (`vip_table_min_spend`,
   `opening_hours` → late-night).
3. **Area** — factual, from the `neighborhood` column / address; the broad
   "ciutat-vella" parent is dropped when a child (barceloneta/el-born/…) is present.

A tag is emitted **only on real signal** — no signal → no tag (never invented).
Tags are structured and **safe to regenerate** every run (unlike pitches).

## The vocabulary (fixed — keep search facets consistent)
- **Genre:** `techno house tech-house afro-house minimal trance hardcore garage
  bass electronic disco funk-soul reggaeton latin hip-hop rnb pop-commercial
  jazz indie-rock` (`electronic` is a broad parent facet auto-added to any
  electronic sub-genre).
- **Space:** `rooftop terrace beach-club pool sea-view garden outdoor underground`
- **Experience:** `cocktails dancing live-music dress-code lgbtq late-night
  guestlist vip-tables`
- **Area:** `area:eixample area:gracia area:gothic area:el-born area:el-raval
  area:barceloneta area:poble-sec area:poblenou area:sant-antoni
  area:port-olimpic area:ciutat-vella …`

To add/adjust tags, edit `GENRE_MAP` / `SPACE_KW` / `EXP_KW` / `AREAS` at the top
of `tag_clubs.py`.

## Current coverage (2026-09-08, active clubs)
321 / 424 active clubs tagged. Most common: cocktails(145), electronic(59),
house(56), area:eixample(53), techno(50), live-music(49), dancing(40),
tech-house(34), afro-house(24), disco(23), outdoor(22), lgbtq(21), terrace(20),
underground(17), pool(15), rooftop(13). The 103 untagged had no RA history, no
usable reviews, and no name keyword — left clean rather than guessed.

## How to search (Supabase / PostgREST)
`tags` is a `text[]` with a GIN index, so these are fast:
- **Has a tag:** `clubs?tags=cs.{rooftop}` (PostgREST) / `tags @> '{rooftop}'` (SQL)
- **Any of several (OR):** `tags=ov.{techno,house}` / `tags && '{techno,house}'`
- **All of several (AND):** `tags @> '{rooftop,cocktails}'`
- **Facet counts** for a filter UI: `select unnest(tags) tag, count(*) from clubs
  where is_active group by 1 order by 2 desc`.

## Notes / next steps
- Genre matching is **exact venue-name** — high precision, some recall gaps where
  the Google-Places name differs from the RA venue name. A small curated alias map
  (like the promoters' `CURATED_CLUBS`) would lift recall; say the word.
- Vibe/crowd tags (upscale / local / touristy) could be added via the local LLM
  from review text, gated + vocab-constrained — deliberately left out of v1 to
  avoid the hallucination issues seen in venue-typing. Easy to add if wanted.
