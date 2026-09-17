# HypeList Barcelona — source notes

## Where their data actually is

Their marketing site (hypelistbarcelona.com, Framer) lists nine venues and no
calendar. Its "Choose Your Night" picker looks like it answers which nights
they run and does not: all seven day tabs render the identical four cards, and
the tabs are plain divs with no distinct panel behind them.

**Their real data is on Fourvenues**, the same platform BesoList use. The venue
pages link out to `site.fourvenues.com/en/hypelist-barcelona@<venue>`, and the
promoter-wide embed serves the whole calendar with no Cloudflare challenge:

    https://site.fourvenues.com/en/iframe/hypelist-barcelona/events

`site.fourvenues.com` itself sits behind an interactive challenge and was not
touched. The embed route is scoped: a nonsense slug on it renders zero events.

## The harvest (17 Sep 2026)

170 events, 17 Sep – 3 Oct, across **24 venues** — not the nine the website
advertises. Per-venue routes go deeper (Opium alone returns 75 events to 30
Nov); the promoter-wide route is capped at roughly a fortnight and query
parameters are rejected.

Cards carry date, start/end, minimum age and music genres in the wrapping
anchor's `aria-label` — note it is the ANCHOR, not the `<article>`.

## Deriving nights

* An event starting before 06:00 belongs to the **previous** night. Without
  that shift every late room reads a day late.
* A night counts as a residency only if it **recurs**. A single sighting in two
  and a half weeks is a one-off; promising it sends someone to a shut room.
* The time window is the most common start→end **pair**, not the two modes
  taken separately — NIX runs both an 18:00 tardeo and a 00:00 club night.

Cross-check: this puts Bling Bling at Wed–Sat and Downtown at Wed–Sat, matching
the independent BesoList harvest of the same rooms.

## Not imported

| Venue | Why |
|---|---|
| Nu Bcn, ETNIA, Brisa Open Air | no row in `clubs` |
| Discoteca Mon Madrid | Madrid, not Barcelona |
| Atlantic Club | only "Atlantic Sound BCN" is close, not clearly the same room; also no residency |
| Duvet, 4 Latas Club | in `clubs`, but one-offs only |

Bastian Beach IS imported but its `clubs` row is **inactive**, so the offer
will not surface until the venue is switched on.
