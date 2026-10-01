# Agentbox — what it runs, and where everything goes

*Last verified against the live box (`crontab -l`, `~/scraper/`, `systemctl`) on 1 Oct 2026.*

Agentbox is a headless Dell Inspiron 5566 running Ubuntu Server 26.04, sitting in the Barcelona flat. It does Club Fuoco's background work: scraping, enrichment, translation, backups and pushes into Supabase. Nobody touches it directly — it is driven from the Mac over SSH.

- **Reach it:** `ssh agentbox` (Tailscale `100.125.231.19`, works from anywhere; Cloudflare WARP on the Mac must be off when away from home).
- **Code:** `~/scraper/` on the box, Python venv at `~/scraper/venv/`. Version-controlled copies of the scripts live in this repo under `scripts/agentbox/`. Edit here, then deploy with `scp scripts/agentbox/<file>.py agentbox:~/scraper/`. (Some older docstrings say `10.0.0.235` — that static IP is gone; use `ssh agentbox`.)
- **Logs:** `~/scraper/logs/` — `cron.log` (most jobs), `fourvenues_reader.log` (Fourvenues pipeline), `vc.log` (investor research).
- **Times below are the box's clock (UTC).**

---

## 1. The schedule

| When (UTC) | Job | In one line | Writes to |
|---|---|---|---|
| **Every hour at :07** | Fourvenues pipeline (6 steps, §2) | HypeList's tickets, guestlists and tables, kept fresh for the app and the portal | Supabase Storage `fourvenues/offers.json`, Supabase `promoter_nights` |
| **:07 and :37** | `nightly_research.py worker` | Promoter and DJ enrichment, DJ discovery, venue typing | Local SQLite in `intel/` |
| 03:00 | `backup_supabase.py` | Full Supabase backup | `~/scraper/backups/clubfuoco/clubfuoco-backup.tar.gz` |
| 04:45 | `pocket_backup.py` | Pocket voice-note archive — **blocked, no Pocket API key yet** | `~/scraper/pocket/`, `backups/pocket/` |
| 08:00 | `nightly_research.py full` | Barcelona events (next 14 days), promoters, DJs, daily digest | Local SQLite/CSV in `intel/` |
| 08:15 | `push_events.py` | Event calendar into the app | Supabase `events` |
| 08:20 | `push_djs.py` | DJ catalogue into the app | Supabase `djs` |
| 08:25 | `link_djs.py` | DJ-only nights become Featured DJ boxes on club pages | Supabase `club_dj_sets` (reads `events`, `djs`) |
| 08:30 | `dj_appearances.py` | Each DJ's own upcoming dates, anywhere in the world | Supabase `dj_appearances` |
| 08:40 | `tag_clubs.py active` | Search tags (genre, rooftop, VIP, area…) for active clubs | Supabase `clubs.tags`, local `intel/tags/` |
| 09:00 Mon–Sat | `vc_research.py light` | Investor list refresh | Local `intel/vc/` |
| 09:30 Sun | `vc_research.py full` | Full investor sweep | Local `intel/vc/` |

The 08:00 → 08:40 chain is ordered on purpose: research first, then events, then DJs, then the links between them, then tags that use both.

---

## 2. Fourvenues pipeline — hourly, one cron line

This is how the app sells HypeList's nights (guestlists, tickets, VIP tables) without a Fourvenues API key: agentbox reads the public booking pages for our referral channel `clubfuoco-hype` and turns them into a feed. Each step only runs if the previous one succeeded, except translation, which can never stop the publish.

| # | Script | What it does | Reads | Writes |
|---|---|---|---|---|
| 1 | `fourvenues_reader.py` | Opens each event's booking page in a headless browser and records the page's own data (events, ticket types, guestlists, table zones). | `web.fourvenues.com/…/clubfuoco-hype` | `intel/fourvenues/fourvenues.sqlite` (keeps the last 48 runs) |
| 2 | `fourvenues_zones.py` | Reads each VIP zone's page for real table sizes, deposits, and whether paying in full is allowed. Re-reads a zone every 12 h. | Fourvenues zone pages | same SQLite (`zone_rates`) |
| 3 | `fourvenues_map.py` | Builds the feed: one event per night, matched to our `clubs`; each product as free guestlist / pay at door / paid ticket / table, with prices, sizes, sold-out state, and guestlist entry times as plain data. | the SQLite | `intel/fourvenues/offers.json` |
| 4 | `fourvenues_i18n.py` | Gives every product name and description an English and a Spanish version: splits 🇪🇸/🇬🇧 and "A / B" pairs, translates anything missing with Claude Haiku. Each text is translated once, ever. | `offers.json` | `offers.json` (adds `*_i18n`), cache `intel/fourvenues/i18n.sqlite` |
| 5 | `fourvenues_push.py` | Publishes the feed. Refuses to publish an empty one. | `offers.json` | Supabase Storage, public: `fourvenues/offers.json` — the iOS app pulls this hourly |
| 6 | `fourvenues_nights.py` | Keeps HypeList's normal events in the portal in step with the feed: links existing nights, creates missing ones, stores what's on sale. Never touches publishing, review, featuring, pinning or price. Products that vanish are kept and marked "no longer on sale". | `offers.json`, `promoter_nights` | Supabase `promoter_nights` (`fourvenues_code`, `fourvenues` snapshot, title, times) |

**Where it shows up:** the app's Guestlist button, Explore cards, club pages and the HypeList event sheet read the Storage feed. The partner portal's HypeList page (Events and Revenue tabs) reads `promoter_nights` plus app bookings from `external_tickets`.

**Related, but not on agentbox:** emailed tickets go to `<token>@tickets.clubfuoco.com` → Resend → the Vercel webhook `/api/inbound/resend`, which files the QR into `external_tickets`. That runs on Vercel, not here.

---

## 3. Research — `nightly_research.py`

One script, three modes: `full` (08:00 daily), `worker` (every 30 min), `events` (events only, manual).

| Part | What it does | Source | Writes |
|---|---|---|---|
| Events | Every Barcelona listing for the next 14 days (~260 events, ~85 venues), split into real events (named artists) and format nights ("set lists"). Accumulates — no duplicates across days. | Resident Advisor GraphQL | `intel/events/events.sqlite`, `upcoming.csv`, `setlists.csv`, daily snapshots |
| Promoters | Barcelona-based promoters, their Instagram stats, which clubs they work with, whether they offer free guestlist / VIP. | RA, Instagram public profile endpoint, Brave Search | `intel/promoters/promoters.sqlite`, `promoters.csv`, dated reports |
| DJs | DJ profiles (socials, followers, genres, images), plus discovery of more Barcelona DJs via past events and related artists. | RA | `intel/events/djs.sqlite`, `djs.csv` |
| Venue typing | Local LLM classifies each club (nightclub / bar / restaurant / hotel…) from its reviews. **Pitch writing to Supabase is OFF** (`PITCH_WRITING_ENABLED = False`) — do not re-enable without Yakov. | Supabase `clubs` (read), Ollama | `intel/curation/venue_types.sqlite`, advisory sheets `recommend_activate.csv`, `recommend_remove.csv`, `not_nightlife.csv` |
| Digest | Daily summary of what's on. | the above, Ollama | `intel/digests/YYYY-MM-DD.md` |

**Safety rails:** a shared daily budget (Instagram 220 calls, Brave 160), a circuit breaker that pauses Instagram for 6 h after 4 failures, and a lock so overlapping runs exit. `python3 check.py` on the box shows today's budget use and breaker status.

---

## 4. Pushes into the app (daily, after research)

| Script | Target | Notes |
|---|---|---|
| `push_events.py` | Supabase `events` | Resolves each RA venue to a `clubs` row through `venue_link.py`'s learned alias store (`intel/venue_aliases.sqlite`). |
| `push_djs.py` | Supabase `djs` | ~1,300 Barcelona DJs with images (hot-linked from RA's CDN). |
| `link_djs.py` | Supabase `club_dj_sets` | Lone-DJ nights become the "Featured DJ" box on a club page. Skips `guest:` placeholder ids. |
| `dj_appearances.py` | Supabase `dj_appearances` | A DJ's upcoming dates in any city, for their timeline — not limited to Barcelona. |
| `tag_clubs.py` | Supabase `clubs.tags` | Fixed vocabulary only, so search filters stay clean. Local copy in `intel/tags/club_tags.sqlite`. |

---

## 5. Investor pipeline

| Script | Schedule | What it does | Writes |
|---|---|---|---|
| `vc_research.py` | Daily light / Sunday full | Sweeps OpenVC's public investor lists, scores fit for a pre-seed/seed consumer nightlife app, de-duplicates. | `intel/vc/vcs.sqlite`, `vcs.csv` |
| `vc_contacts.py` | By hand | Finds websites and contact routes for the scored funds. | `intel/vc/vc_contacts.csv` |
| `vc_outreach.py` | **By hand only — never without Yakov** | Sends personalised pitch emails through Resend from investor@clubfuoco.com. | Resend (sends), `intel/vc/outreach.sqlite` |
| `vc_replies.py` | By hand | Reads replies and sorts them into interested / not now / no. | `intel/vc/outreach.sqlite` |

---

## 6. Run-by-hand tools

| Script | What it does | Writes |
|---|---|---|
| `ingest_venues.py` | Turns event venues we don't have yet into real `clubs` rows, if Google Places says they're nightlife, and mirrors their photos. | Supabase `clubs`, Storage `venue-photos/` |
| `enrich.py`, `enrich_borme.py` | Finds club management contacts (website, company registry) — strict, only confident matches. | Local output |
| `check.py` | Status page: budgets, breaker, calendar summary. | — |
| `patch_*.py`, `test_*.py`, `purge_bad.py`, `merge_truncated.py` | One-off fixes from past incidents. Not part of any schedule. | — |

Also in this repo but run from the Mac: `scripts/host-club-photos.py` (hosts Google photos for clubs that have none, into Storage `venue-photos/`).

---

## 7. Services, secrets, machine

- **Always-on services:** `ollama` (local models `llama3.1:8b`, `llama3.2:3b`, used for venue typing and digests), `glances` (system monitor, local only), `smbd` (Finder file share), `tailscaled` (remote access).
- **Secrets** in `~/scraper/secrets/`, all readable by the owner only:
  - `supabase.env` — Supabase URL and service-role key (every Supabase write above).
  - `anthropic.env` — Claude key for the Fourvenues translation step. **Rotate it**: it was pasted into a chat on 1 Oct 2026. Overwrite the file with the new key; nothing else changes.
  - `vc.env` — Resend and investor-pipeline settings.
  - `pocket.env` — Pocket voice notes (no working key yet).
- **Machine:** Intel i3-7100U, 7.2 GB RAM, 1 TB HDD (~18 GB used). Planned: +8 GB RAM and an SSD.

## 8. When something looks wrong

| Symptom | First check |
|---|---|
| App shows stale HypeList nights | `tail -50 ~/scraper/logs/fourvenues_reader.log` — the reader, then "published N events" from the push |
| English users see Spanish product text | Same log — look for `i18n:` lines; a key problem says so in plain words |
| Portal HypeList events not updating | Same log — `nights:` line (`wrote N updates, N inserts`) |
| Instagram stats stopped growing | `python3 check.py` for a BLOCKED breaker |
| No new events in the app | `grep push_events ~/scraper/logs/cron.log`, then the 08:00 research run |
| Can't reach the box | Mac: WARP off, `tailscale status`; at home try the LAN; last resort is an Ethernet cable (see the box's rescue notes) |
