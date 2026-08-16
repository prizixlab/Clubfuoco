# Club Fuoco — DJ page: the data

A brief for designing the **DJ page**. This describes only what data exists,
how often it is actually there, and what it means. No layout decisions here —
those are yours.

Context: the DJ page opens from a "Featured DJ" box on a club page. It is a
sheet over that club. Club Fuoco is Barcelona-only today.

---

## 1. Identity

From the RA-scraped artist catalogue. Fill rates are measured over the **53
DJ slots currently live in the app**, not the whole 2,764-row catalogue — this
is what a real page will actually have.

| Field | Type | Present |
|---|---|---|
| `name` | text | **100%** |
| `image_url` | square-ish portrait, RA CDN | **91%** |
| `genres[]` | array of strings | 68% — **median count is 1**, max 5 |
| `regions[]` | array, most-played first | 87% — first entry is used as origin ("Barcelona", "Ibiza") |
| `known_venues[]` | array of venue names, no dates | 77% |
| `cover_image_url` | wide image | **21%** |
| `bio` | long text | **0% — never populated. There is no bio to show.** |
| `ra_followers` | int | present, currently unused on the page |

Social links, each independent:

| | Present |
|---|---|
| `soundcloud` | 66% |
| `instagram` | 45% |
| `website` | 28% |

**Two identity facts that shape the page:**

- **1 in 3 DJs has no SoundCloud.** The audio preview is the page's richest
  element and it is absent a third of the time. That is a normal state, not an
  error state.
- **5 of 53 are "guest" DJs** — surfaced by name from a single-DJ night, with no
  catalogue entry at all. They have a name, a residency line, and nothing else:
  no photo, no genres, no socials, no timeline.

---

## 2. Residency — how they relate to *this* club

Always present on every slot (100% for both fields).

| Field | Values seen |
|---|---|
| `residency_label` | `Guest` (48), `Resident` (5) |
| `night` | `Saturdays` (20), `Thursdays` (10), `Fridays` (9), `Mondays` (5), `Tuesdays` (4), `Wednesdays` (3), `Sundays` (2) |

Currently rendered as one line: "Guest · Saturdays". This is a **recurring
weekday**, not a date.

A guest-list offer may also exist for that night — that is a separate commercial
object, not part of the DJ's data, and it is only sometimes available.

---

## 3. Timeline — where they are actually playing

Dated appearances scraped per artist, so it covers **every city they play**, not
only Barcelona. This is the newest and most distinctive data on the page.

Per appearance:

| Field | Notes |
|---|---|
| `date` | yyyy-MM-dd, future only |
| `start_time` | timestamp, sometimes null |
| `venue_name` | **100%** |
| `title` | the event's name, **100%** |
| `city` | e.g. Barcelona, Ibiza, Paris, Berlin |
| `country` | e.g. Spain, France |
| `club_id` | **nullable — this is the important one** |

**`club_id` splits every row into two kinds:**

- **set** → the venue is one we carry. The user can act on this night: it opens
  that club's page.
- **null** → a city we have not launched. The night is real and worth showing,
  but there is nothing to book. The product's answer today is a "coming soon"
  note naming the city.

Shape of the data, across the 53 live DJs:

| | |
|---|---|
| DJs with at least one dated appearance | **47 of 53** (6 have none) |
| Rows per DJ | median **2**, min 1, max **21** |
| Rows that are actionable (`club_id` set) | **29 of 211 — about 14%** |
| Distinct cities | **41** |

So the typical DJ has **two** upcoming dates; a touring headliner may have
twenty. And **the large majority of rows are places the user cannot go.** A DJ
whose next three nights are Ibiza, Paris and Milan is the common case, not the
exception.

---

## 4. What the data cannot do

State these as constraints, not as things to design around later:

- **No bio.** 0% populated.
- **No past history** — future dates only.
- **No ticket price, capacity or lineup position** on an appearance. We do not
  know if they headline or open.
- **No follower/popularity display** currently in use.
- **No Resident Advisor link.** Deliberate: RA is the upstream source, and the
  product does not send users there. If the data isn't ours, it isn't shown.
- **A "guest" DJ is nearly empty** — name and residency line only.

---

## 5. The states a design has to survive

Ordered roughly by how often they occur:

1. **Full** — photo, genres, origin, SoundCloud preview, several dated nights.
2. **No preview** (≈1 in 3) — everything else, but no audio.
3. **Mostly away** (common) — the timeline exists but almost every row is a
   city we don't serve.
4. **One line only** (6 of 53) — residency line, no dated appearances at all.
5. **Guest** (5 of 53) — a name and "Guest · Saturdays". Nothing else exists.
6. **No photo** (≈1 in 10) — name-first.

State 5 and state 1 are the same page. That range is the actual design problem.
