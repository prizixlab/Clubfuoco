# HypeList Barcelona — source notes

Read from https://www.hypelistbarcelona.com on 17 Sep 2026.

## What the site publishes

* **9 venue guestlist pages** (`/<venue>-guestlist-barcelona`), each with a
  "Club Information" block: dress code, neighbourhood, music, crowd, and
  whether VIP tables are available.
* **A tickets page** with minimum ages and, for Downtown and Twenties,
  "FREE ENTRY UNTIL 1:00 AM".
* **Their logo** — a bunny in sunglasses under a cocktail umbrella, white
  line-art inside a rainbow bloom. `hypelist-mark-original.png` is the
  untouched 842x842 nav asset.

## What it does NOT publish

* **No events.** There is no calendar anywhere on the site — no dates, no
  listings, no ticket links to a platform that has them. BesoList's 383 events
  came from a Fourvenues public embed; HypeList have no equivalent.
* **No operating nights.** The homepage "Choose Your Night" picker looks like
  it answers this and does not: clicking each of Monday…Sunday renders the
  identical four cards (Sutton, Opium, Downtown, Pacha, looped). The day tabs
  are plain divs with no distinct panel behind them. Verified by reading the
  DOM for all seven days.
* **No door times, no capacities, no VIP prices.**

## Consequences

`valid_days` and `time_window` in `scripts/import-hypelist.mjs` come from the
BesoList harvest of the SAME ROOMS, not from HypeList — a venue's operating
nights belong to the venue, not to whoever fills it. Each row records this.

Three of the nine advertised venues are held back because no source covers
them: Jamboree, Shôko and CDLC. See `HELD` in the import script.
