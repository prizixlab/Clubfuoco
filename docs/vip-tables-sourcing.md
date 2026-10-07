# VIP tables — where they actually live, and how to sell them in-app

**Captured:** 30 Aug 2026 · **Scripts:** `scripts/vip-websites.mjs`, `scripts/vip-platforms.mjs`
**Reports:** `scripts/vip-websites-report.json`, `scripts/vip-platforms-report.json`

---

## The correction

The working assumption was that a VIP table is a price. It is not. It is a
**seat on a floor plan**: the club publishes a zone map, you pick a table in a
zone, the table carries a rate (minimum spend, included persons, supplement per
extra head, deposit), and you *apply* — the club approves or declines before any
money is final.

`clubs.vip_table_min_spend` — a single nullable number, set on 8 of 1,753 rows —
cannot represent that. Neither can the current `bookings` row.

## What is actually behind the "reservar mesa" button

Club websites are facades. Nobody built a table-reservation system; they rent
one, and the vendor owns the zone map, the rates and the checkout. So the
integration surface is **the vendor list, not the venue list** — and the vendor
list is short.

`vip-platforms.mjs` probed 331 nightlife venues (Google `night_club`/`bar` type,
website resolved via Places). Of the 55 true `night_club`s, **35 actively market
mesas / reservados / VIP**. Their booking engines:

| Engine | VIP-selling clubs | Share |
|---|---:|---:|
| **Fourvenues** | 10 | 29% |
| WhatsApp only (a phone number) | 5 | 14% |
| Wix / Squarespace page, no engine | 5 | 14% |
| Dice (tickets, not tables) | 4 | 11% |
| Own site, no engine at all | 4 | 11% |
| WooCommerce storefront | 3 | 9% |
| Notikumi | 2 | 6% |
| CoverManager (restaurant tool) | 2 | 6% |

29% understates it. Fourvenues holds **44% of the VIP-selling clubs weighted by
Google review volume (72,394 of 164,122)** and, more to the point, it holds the
exact rooms the incumbent list operator monetises:

| Club | Reviews | Engine | Where the VIP funnel is |
|---|---:|---|---|
| Razzmatazz | 22,881 | Fourvenues | `site.fourvenues.com/es/<org>/events/<slug>` |
| Ku (formerly Pacha) | 8,950 | Fourvenues | `fourvenues.com/assets/iframe/ku-barcelona/calendar` |
| Opium | 8,478 | Fourvenues | `opiumbarcelona.com/vip/` → Fourvenues |
| Ilusion (Luz de Gas) | 6,913 | Fourvenues | Fourvenues |
| CDLC (Carpe Diem) | 4,641 | Fourvenues | `cdlcbarcelona.com/reservas/` → Fourvenues |
| Bling Bling | 3,590 | Fourvenues | Fourvenues |
| Twenties | 3,182 | Fourvenues | `twentiesbarcelona.com/vip-experience/` |
| Barroko's | 2,638 | Fourvenues | `site.fourvenues.com/es/barrokos-barcelona` |
| Sala Apolo | 12,013 | Notikumi | widget |
| Shôko | 10,405 | Notikumi | Shopify storefront + WhatsApp |
| Sutton | 5,145 | **WhatsApp** | `wa.me` — no engine |
| Otto Zutz | 5,326 | **WhatsApp** | Wix events page |

Cross-check against `docs/competitor-shaz-list.md`: their €400–€5,000 tables are
sold at Opium, Shoko, Ku Pacha, Sutton, Downtown, Twenties, Bling Bling. Seven
venues. **Five of those seven are one integration.**

## Correction: a club's ticket engine is not its table channel

The table above fingerprints **home pages**, and that overcounts. Loading each
club's own VIP page shows the two channels are usually different vendors — the
club sells tickets through Fourvenues and takes tables on a phone.

Every club the fingerprint flagged as Fourvenues, checked by hand on 30 Aug by
loading its actual table-booking page:

| Club | Tables are actually sold by | Table engine? |
|---|---|:--:|
| **Opium** | Fourvenues — `/calendario/` calls `api.fourvenues.com/no-auth/events`; CTA reads "Entradas & Mesas vip". 7 zones. | **yes** |
| **Ku (Pacha)** | Fourvenues — embeds `fourvenues.com/iframe/ku-barcelona/calendar`. | **yes** |
| **Bling Bling** | Fourvenues — `/events-calendar/` calls `api.fourvenues.com`; CTA reads "Tickets & vip tables". | **yes** |
| Razzmatazz | `reservado@salarazzmatazz.com` + `wa.me/34670976380`. Its Fourvenues links belong to touring promoters (`gira-camin`, `sala-uni`) renting the room, not to Razz. | no |
| Downtown | `wa.me/34676243907`. Fourvenues iframe is the events calendar. | no |
| CDLC | `vipservice@cdlcbarcelona.com` / +34 647 779 999. CoverManager is restaurant covers. | no |
| Twenties | Jordi, +34 611 251 592. Fourvenues is the ticket path. | no |
| Barroko's | WhatsApp 635454106. €150/table: entry for 5, one bottle, 10 mixers, **paid at the club**. | no |
| Shôko | `wa.me/34663701082`. Notikumi is ticketing. | no |
| Ilusion (Luz de Gas) | Org `luz-de-gas` exists on Fourvenues; table path not yet traced. | unknown |
| Malalts de Festa, Wolf | Not yet checked; Wolf markets no VIP at all. | unknown |

So the "10 clubs on Fourvenues" figure counts *ticketing* relationships and must
not be quoted as table coverage. **Three of the eleven sell tables through an
engine.** Treat every Tier A assignment as unconfirmed until someone has loaded
that club's own table page — `club_vip_sources.verified_at` records when that
happened.

Note what Barroko's reveals about the wider tail: the table is paid **in cash at
the door**. Even a perfect API integration would not capture that money, which is
worth knowing before anyone models a take rate on table GMV.

## The automation path: Fourvenues Channel Manager API

Fourvenues publishes three APIs (`docs.fourvenues.com`). The relevant one is the
**Channel Manager API** — explicitly "for marketplaces, ticket platforms, and
multi-venue operators". That is us.

- Base: `https://channels-service.fourvenues.com` (alpha: `channels-service-alpha.…`)
- Auth: `X-Api-Key` header. One key per **channel**; a channel is "your identity
  in the system — a marketplace or partner entity authorized by one or more venues."

It carries the entire funnel:

| Need | Endpoint |
|---|---|
| Which venues have authorized us | `GET /organizations`, `GET /locations` |
| Nights | `GET /events`, `GET /events/by-slug/{slug}` |
| **The zone map** | `GET /bookings/zones/?event_id=` |
| What is still free | `GET /bookings/availability/?event_id=&quantity=` |
| Apply for a table (club approves) | `POST /bookings/request` |
| Pay for a table | `POST /bookings/checkout` |
| State + QR | `GET /bookings/{id}` |
| Money settled / refunded | `POST /webhooks/endpoints` |

### The zone map is renderable natively

`Zone` → `spaces: Table[]`, and `Table.position` is `{ x, y, scale, rotation }`.
That is a literal floor plan in coordinates, not an image and not an iframe — so
the table picker can be **native SwiftUI**, drawn in Fuoco's own palette, with no
web view and no third-party chrome anywhere in the flow.

`TableRate` gives `price`, `included_persons`, `supplement_persons`,
`supplement_price`, `deposit`, `full_payment`, `max_clients` — enough to quote a
real total for a party of N before the user commits.

### Two things that land better than expected

1. **`Booking.channel_id` + `Booking.referral_id`.** Fourvenues attributes a
   booking to a channel *and* a referrer natively. Our promoter attribution maps
   onto `referral_id` with no invention required — a promoter's VIP sale is
   traceable end to end, at the source, by the club's own system.
2. **`Booking.qr_code`.** A Fourvenues table booking already carries a QR. Fuoco
   Door (`docs/fuoco-door-app-plan.md`) can scan it. Attendance proof — the one
   thing `docs/competitor-shaz-list.md` says no list operator can produce —
   extends from free guestlist heads to €400+ tables.

### The catch, stated plainly

> "Your API key only sees events from venues that have added you as a partner."

Venues authorize channels; channels cannot self-serve. **This is a BD motion
with an engineering tail, not the reverse.** No amount of building unlocks a
single table. The first call is Fourvenues' partnerships team to get channel
credentials against the alpha server, and the second is one venue — Twenties or
Barroko's are the realistic first yes, Opium the one worth winning.

Nothing here requires scraping. It is worth noting that we could not have
scraped it anyway: `site.fourvenues.com` event pages return **403 behind a
Cloudflare challenge** to a plain client. The sanctioned API is not merely the
polite path, it is the only path.

## Everything that is not Fourvenues

| Tier | Who | Approach |
|---|---|---|
| **A — API** | Fourvenues (10) | Channel Manager. Full native flow, real-time availability, instant confirmation. |
| **B — evaluate** | Notikumi (Apolo, Shôko), CoverManager | Check for an equivalent channel/partner API before assuming parity. Both are widget vendors; neither is confirmed to expose zones. |
| **C — request, don't sell** | WhatsApp / no engine (Sutton, Otto Zutz, Gatsby, +) | The app takes a structured VIP *request* — date, party size, zone preference, budget band — and Fuoco relays it. The user gets a tracked request in-app instead of an unanswered DM. Manual on our side, invisible to them. Tier C is also the honest way to start: it needs no counterparty's permission. |
| **D — out of scope** | Dice/WooCommerce ticket-only rooms (Moog, Sidecar, Bikini) | These sell tickets, not tables. Leave them to the existing affiliate click path. |

Tier C matters more than its ranking suggests. It is the only tier that can ship
without a signature, it produces the demand evidence needed to make the Tier A
pitch ("we sent you 40 table requests last month, here they are"), and it makes
the app complete on day one rather than covering a third of the market.

## Data model gap

Neither `clubs.vip_table_min_spend` nor `bookings` can hold this. Needed:

- `club_booking_sources` — club ↔ engine ↔ external org id ↔ credential ref, so a
  club's engine is data, not a hard-coded branch. Mirrors the swappable-supplier
  pattern already used by the Partner Portal.
- `vip_zones` / `vip_tables` — cached zone + table + `position` + rate snapshot
  per event, so the floor plan renders instantly and survives an API blip.
  Cache is a render cache only; availability is always fetched live.
- `bookings` additions — `source` (`fuoco` | `fourvenues` | `manual_request`),
  `external_booking_id`, `external_event_id`, `zone_slug`, `table_id`,
  `rate_slug`, `request_status` (`requested` | `approved` | `declined`).

The `requested → approved` state is new and non-optional: a Fourvenues table is
an application, and the current `bookings.status` has no vocabulary for a
booking the club has not yet accepted.

Note that a Tier A table sale is **not** a Stripe Connect destination charge —
Fourvenues runs the checkout, so our 12% (`DEFAULT_PLATFORM_FEE_BPS`) does not
apply and commercials come from the channel agreement instead. That difference
needs settling with Fourvenues before anything is built, because it decides
whether a Tier A table earns anything at all.

## Build order

1. **Tier C first.** Structured VIP request → stored booking with
   `source='manual_request'`, `request_status='requested'`. Ships without any
   counterparty. Generates the demand proof.
2. **Channel credentials.** Contact Fourvenues partnerships; get an alpha
   `X-Api-Key`; confirm commercial terms and whether a channel can be paid.
3. **Read path.** `GET /organizations` → `/events` → `/bookings/zones/`.
   Native SwiftUI floor plan from `Table.position`. Read-only, no checkout.
4. **Write path.** `POST /bookings/request` with `referral_id` carrying the
   promoter, then `POST /bookings/checkout`. Webhook endpoint for settlement.
5. **Close the loop.** Feed `Booking.qr_code` to Fuoco Door so a table scans in
   like a guestlist head, and the attendance record covers paid inventory.

## Tonight's scope: the rooms Rumbalist is already in

`rumbas` is six seeded demo rows from May. The real footprint is
`rumbalist_purchases` — 38 free-guestlist signups (plus 2 `Test`) across eight
rooms. Every one of those eight now has a verified row in `club_vip_sources`:

| Room | Guestlist signups | Tables sold via | Tier |
|---|---:|---|:--:|
| Opium | 10 | Fourvenues · 7 zones | **A** |
| Disco City Hall | 8 | — no table product | N |
| Ku (Pacha) | 7 | Fourvenues · org `ku-barcelona` | **A** |
| Shôko | 5 | WhatsApp `+34 663 701 082` | C |
| CDLC | 3 | `vipservice@cdlcbarcelona.com` | C |
| L'Ovella Negra | 3 | — rock bar | N |
| Twenties | 1 | Jordi `+34 611 251 592` · 6 published zones | C |
| Jamboree | 1 | — jazz cellar | N |

Read that as: **five of the eight rooms sell tables, and only two of them sell
tables through anything we could call.** Twelve of the 38 signups are in rooms
with no table product at all. The relay flow is not a stopgap for this footprint,
it is most of it — so `supabase/migrations/vip_requests.sql` builds that first.

Twenties is the useful one to start with: it publishes its entire zone price list
(Yellow €300/5 pax through Tiffany Blue €2,500/12 pax), so the app can quote a
real number on night one instead of "from €400". Those six zones are seeded into
`club_vip_zones`.

**Not yet applied.** Production schema drifts from this directory, so review and
run it in the SQL editor rather than assuming a migration tool will.

## Reproducing the research

```bash
node --env-file=.env.local scripts/vip-websites.mjs   # Places → website + types
node scripts/vip-platforms.mjs                        # website → booking engine
```

Stage 1 bills Google Places (Basic + Contact, ~$20/1000). It resumes from its own
report, so a re-run costs nothing for rows already fetched. Both scripts are dry
runs and write no database rows.

**Caveat on the venue set:** `clubs` is a POI dump, not a nightlife list — the
top rows by review count include a hospital, a football stadium and a great many
tapas bars. `ra_venue_slug`, `dice_venue_id`, `xceed_venue_id`, `music_genres`
and `max_capacity` are empty on every row, so Google's `types` is currently the
only nightlife filter we have, and it costs a billed call per venue. Only the
top 450 by review volume have been swept; the remaining ~1,280 are unclassified.
