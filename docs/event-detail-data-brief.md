# Club Fuoco — Event detail: the data

A brief for designing the **expanded event view** — what opens when someone taps
an event on a club page. This describes only what data exists, how often it is
really there, and where it lies. No layout decisions here.

Context: a club page lists what's on. A night billed to **one** DJ becomes a DJ
box (separate surface, separate brief). A night with a **lineup** is an event,
and that is what this view expands. Club Fuoco is Barcelona-only.

All figures measured on the **161 upcoming event cards** currently live.

---

## 1. Always there

| Field | Present | Notes |
|---|---|---|
| `title` | **100%** | promoter-written, e.g. "SUMMER HEROES: Open Air with Michelle Manetti" — long, often with a `:` or `x` structure |
| `date` | **100%** | |
| `start_time` | **100%** | door time |
| `end_time` | **99%** | |
| `venue_name` | **100%** | |
| `interested` / `attending` | **100%** | RA counts. Median **12**, max **1042** — a linear treatment will be dominated by outliers |
| `ra_url` | 100% | source link; **not shown to users** by product decision |

**Nights run late.** Median duration is **6 hours** and **87 of 161 end between
02:00 and 08:00**. An end time is routinely on the *next calendar day* — a
design that renders "23:00 – 06:00" as if both belong to `date` will read wrong.

One row has a 54-hour duration. Bad source data exists; it isn't filtered.

---

## 2. The lineup — the centre of this view

| | |
|---|---|
| Events with a lineup | **111 / 161 (69%)** |
| Events billing **2 or more** DJs | **94 / 161 (58%)** |
| Lineup size | median **3**, max **10** |
| Credits that open a DJ page | **319 / 354 (90%)** |

Each credit is `{id, name}` in **RA's billing order** — first is the headliner.
The `id` is the DJ's key, so a credit links straight to that DJ's own page
(photo, genres, SoundCloud preview, their upcoming dates in every city).

**10% of credits do not resolve** to a DJ we hold. Those are real names that
must still appear; they simply cannot be tapped. A design where every name is
visibly a link will show 1-in-10 broken affordances.

`artists` (names only, unordered) still exists for older rows — treat `lineup`
as the truth.

---

## 3. Present, but often absent

| Field | Present | Notes |
|---|---|---|
| `image` (flyer) | **92%** | RA flyer art, portrait-ish, wildly varied quality |
| `description` | **71%** | promoter copy |
| `promoters` | 90% | median 1, up to 4 |
| `club_id` | 79% | set = the venue is one of ours and can be opened |
| `minimum_age` | **76%** | only ever `18`, `20`, `21` |

**Description is not a summary.** Median **638 characters**, max 1283 — it is
marketing prose with line breaks, sometimes multilingual, occasionally emoji.
**98 of 161 events (61%) have 200+ characters of it**; 9 are under 80
characters and say nothing.

**`minimum_age` null does NOT mean all ages.** It means RA holds no policy.
Rendering an absence as "no age limit" would be inventing a door policy.

---

## 4. Fields that look usable and are not

These are the traps. Each is populated often enough to seem safe.

**`cost` — free text, meaningless in 60% of rows.**
Real values in the table right now:

    "€12-€22"   "0€"   "0"   "30"   "10€/15€"   "€"   "40"   "25"

96 of 161 are `0`, `€`, or blank. There is no currency field, no structure, and
no way to tell "free" from "unknown". **It must never be rendered as a price.**

**`venue_capacity` — half of it is the string `"0"`.**
Non-null on 99% of rows, but **80 of 160 are `"0"`**, so only **80 of 161 (50%)**
carry a real number. Values are strings ("60", "500", "3000"). Treat `0` as
absent, not as a capacity.

**`interested` is not attendance.** It is an RA bookmark count, median 12. It
does not indicate whether a night is busy or selling.

---

## 5. Does not exist at all

Confirmed absent from the source, not merely unscraped — do not design a slot
for these:

- **Set times / stage times.** RA has the field; it is populated for festivals
  only, and was empty on every Barcelona club night sampled.
- **Ticket prices, tiers, availability, "sold out".** RA exposes these only for
  events it sells itself — zero of our events. There is no ticket link.
- **Dress code, table/bottle service, age-policy detail beyond the number.**
- **Genre tags on the event.** (Genres exist per DJ, not per night.)
- **Any "who's going" from our own users.**

---

## 6. The states this view has to survive

Roughly by frequency:

1. **Rich** — flyer, 200+ words of copy, 3+ linked DJs, age, real capacity.
2. **No lineup** (29%) — a titled night with promoters but no billed artists.
3. **No description** (29%) — nothing to read; title, time, lineup only.
4. **No flyer** (8%) — text must carry the whole view.
5. **Unlinked credits** (10% of names) — present, not tappable.
6. **Junk cost / junk capacity** (~60% / ~50%) — the fields exist and are lies.

The honest floor is: **title, date, start and end time, venue, and a promoter**.
Everything else — flyer, copy, lineup, age, capacity — is a maybe. A design that
only holds together at state 1 will look broken on roughly half the calendar.
