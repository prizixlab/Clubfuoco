# Booking system: edge cases, failures, error copy, protocols

Audit of every way a guest gets into a night through Club Fuoco, as of
2026-10-05 (`e230480`). This is from reading the code only: nothing was run
against Stripe, Fourvenues or production. Every finding cites the line it
comes from; anything not confirmed in code is in §7.

**Paths covered**

| Path | Money | Code |
|------|-------|------|
| Fourvenues / HypeList: free, pay-at-door, ticket, table | Fourvenues takes it | `ios-native/…/Features/Fourvenues/`, `src/app/api/inbound/resend/`, `scripts/agentbox/fourvenues_*.py` |
| Rumbalist free guestlist | None | `src/app/api/rumbalist/join-guestlist` |
| Rumbalist VIP table (Apple Pay) | Stripe, platform account | `rumbalist/create-vip-intent` → `rumbalist/confirm-vip` |
| Promoter nights: free claim and paid checkout | Stripe Connect, promoter is merchant | `promoter-invites/[token]/claim`, `…/checkout`, webhook, `admin/sweep-holds` |
| Legacy club booking (card) | Stripe, platform | `api/bookings` POST/DELETE |
| Legacy guest lists | None or `price_cents` | `api/guest-lists/[id]/signup` |
| Legacy ticket orders | Stripe + manual fulfilment | `api/tickets`, `api/tickets/confirm` |
| Door | — | `api/door/resolve`, `api/door/admit`, `src/lib/door.ts`, `ios-door/` |

The legacy routes may not be called by the current app, but **they are live on
Vercel and anyone with a session (or none) can call them**. A route nobody
uses is still an attack surface, so it stays in this audit.

**Severity**
- **S1**: money lost, entry without paying, or another person's data or ticket. Fix before the next release.
- **S2**: a guest is stuck, charged without a ticket, or turned away wrongly.
- **S3**: wrong or confusing, with a workaround.
- **S4**: polish and stale comments.

---

## 1. All findings at a glance

| ID | Sev | Area | One line |
|----|-----|------|----------|
| BK-01 | ✅ fixed | VIP | The phone set the VIP table price. €0.50 booked a table |
| BK-02 | ✅ fixed | Promoter | A paid night could be claimed free via `/claim`, and the door admitted it |
| BK-03 | ✅ fixed | Tickets | `/api/tickets` takes price and quantity from the client. `/confirm` doesn't tie the payment to the order |
| BK-04 | ✅ fixed | Guest lists | No auth on check-in, signups list (names/emails/phones), edit, delete or create. Signup took any party size or tier |
| BK-05 | ✅ fixed | Fourvenues | Account switch on one phone pushed A's tickets into B's account |
| BK-06 | ✅ fixed | VIP | Apple Pay succeeds, `confirm-vip` fails: charged, no booking, nothing rescues it |
| BK-07 | ✅ fixed | Legacy booking | Stripe charges, then the DB insert fails: charged, no booking. No idempotency key, so a double tap charges twice |
| BK-08 | ✅ fixed | All Stripe | Refunds and chargebacks are never recorded. A refunded guest still gets in |
| BK-09 | ✅ fixed | Door | The server never says "wrong night". A booking for next week scans OK tonight. `admit` records entries for cancelled bookings |
| BK-10 | ◐ partly | Door | Open-access `admit`/`void` has no auth. Anyone with a QR can void a check-in or burn a booking |
| BK-11 | ✅ fixed | Promoter | Abandon Stripe, come back: "You already have a spot", locked out for up to ~2 h |
| BK-12 | ✅ fixed | Fourvenues | Door lists filed from email lose the money owed at the door |
| BK-13 | superseded | Fourvenues | Queue or captcha nights are a dead end: "try again" never works |
| BK-14 | ✅ fixed | Fourvenues | Pay, then close before the PDF loads: no record anywhere but email |
| BK-15 | ✅ fixed | Fourvenues | Apple relay accounts get no QR anywhere if the inbox is off |
| BK-16 | ✅ fixed | Fourvenues | The pay button shows the feed price, not what will be charged |
| BK-17 | ✅ fixed | Legacy booking | Cancel and refund are allowed after the night if the door never marked it used. A failed refund goes nowhere |
| BK-18 | ✅ fixed | Promoter | Anonymous checkout spam can hold a night sold out (30-min holds, no dedupe, no rate limit) |
| BK-19 | ✅ fixed | Rumbalist | One user can join the same free list again and again (+9 each) and eat the cap |
| BK-20 | ✅ fixed | Fourvenues | Email merges into the wrong ticket on a two-booking night |
| BK-21 | ✅ fixed | Fourvenues | One entry shows as two cards when the email beats the sync |
| BK-22 | ✅ fixed | Fourvenues | Fourvenues' raw page text is shown as the error |
| BK-23 | ✅ fixed | Fourvenues | Phone gets `+34` glued on: UK and `0034` numbers fail |
| BK-24 | ✅ fixed | Fourvenues | An email-only ticket gets the arrival date when the date doesn't parse |
| BK-25 | ◐ partly | All | Raw Stripe and Postgres messages reach the guest (`err(e.message)`, `error.localizedDescription`) |
| BK-26 | ✅ fixed | Fourvenues | No under-age check before signing up to an 18+/21+ night |
| BK-27 | ✅ fixed | Fourvenues | Feed can be ~2 h stale with no indicator; sold-out shows as a generic error |
| BK-28 | ✅ fixed | Promoter | Geofence check-in stamps unpaid (pending) guests as checked in |
| BK-29 | ✅ fixed | Promoter | `verify-payment` says the sweeper runs daily; it's hourly |
| BK-30 | ✅ fixed | Dates | `resolveBookingDate` accepts yesterday, and defaults to "tomorrow" when no date is sent |
| BK-31 | ✅ fixed | Fourvenues | `FVInbox` caches the inbox address forever, even if the inbox is switched off |

---

## Fixed 2026-10-05 (not yet deployed)

- **BK-01.** `src/lib/vip-price.ts` prices the table from the live
  `partner_offers` feed. `create-vip-intent` refuses an amount that isn't a
  live VIP price at that club, and checks the night *before* Apple Pay (also
  closes the date-after-charge half of BK-06). `confirm-vip` requires the
  intent's `source` and `club_id` to match, takes the night from the intent,
  and re-prices any intent created before the check existed. The app now
  sends `booking_date` with the intent. Note: production's `/api/partner`
  currently returns **zero** offers, so no VIP table is on sale until a
  supplier publishes one in the portal.
- **BK-02.** `/claim` returns the guest's existing row first, then refuses a
  night whose live price is > 0 (*"This event is ticketed — buy your spot
  instead."*) or whose paid waves are all gone (sold out). Both apps already
  route paid nights to `/checkout`.
- **BK-04.** `src/lib/guest-lists.ts`: every guest-list write and the
  signups list now require the signed-in user to be in `club_staff` for the
  list's club. That covers check-in PATCH, `?view=signups`, list PATCH (now
  limited to editable fields, so no moving `club_id` or resetting
  `signups_count`), DELETE and create. Signup is zod-validated (party 1–10,
  `vip` only on VIP lists and refused when priced), only bumps
  `signups_count` when the trigger didn't, and numbers the waitlist
  properly. Still open: the count isn't atomic; the Wallet pass route is
  reachable by anyone who knows a signup id.
- **BK-05.** `FVTicketStore` keeps one file per account
  (`fourvenues-tickets-<uid>.json`) and switches whenever `AuthStore.user`
  changes. Signed out, it's empty. The old shared file is adopted by the
  first account to sign in. The saved checkout phone is per account.
  `FVAccountSync` refuses to run, or to keep going after an await, if the
  store belongs to another account.

- **Free guestlist pass screen (requested 2026-10-05).** The guest never
  sees a placeholder QR and never reaches Fourvenues. After joining, the
  sheet says **"Give us a second to get your ticket"** and pulls the account
  every 2 s; the QR pops in when it lands (~4 s in production on 5 Oct: join
  01:23:30, inbox filed 01:23:34). After 90 s it says the ticket will appear
  in Tickets with a notification. Root cause, confirmed in the device trace:
  **a guestlist sign-up reply never carries the door code** (keys are only
  `nombre, idx, email, apuntados, _id, purchase_id`, 18 of 18 sign-ups), so
  the QR only ever arrives by email. Removed: "View ticket" (Fourvenues'
  page), "Fourvenues PDF", the "QR is in the email from Fourvenues" copy, and
  the visible Fourvenues form when the profile has no name (now FV-A01
  `fv.needsProfile`). **This supersedes the BK-13 / FV-Q01 advice below:** a
  queue or captcha stays in our UI as `fv.cantComplete`; the guest is never
  sent to Fourvenues for a free list.

## Fixed 2026-10-05, round 2 (not yet deployed)

Server:
- **BK-03.** `/api/tickets` prices from our `events` row (`source_ref`),
  quantity 1–10, refuses unknown/zero/sold-out prices, cancels the intent if
  the order can't be saved. `/tickets/confirm` requires the order's own
  intent, user and amount.
- **BK-06.** `lib/vip-booking.ts` writes the table for both `confirm-vip`
  and the webhook (`payment_intent.succeeded`, `source = rumbalist_vip`),
  idempotent on the payment intent. The app retries `confirm-vip` and then
  says "Payment received — we're saving your table. Don't pay again."
- **BK-07.** `POST /api/bookings` checks for a recent identical booking,
  saves the row as `pending` first, charges with
  `idempotencyKey = booking-<id>`, confirms only a still-pending row
  (refunds in full if cancelled mid-payment), and the webhook confirms by
  `booking_id`. Refuses to charge more than the client's `expected_total`
  (the app sends it). Card errors show Stripe's cardholder message; other
  errors show our own copy.
- **BK-08.** Webhook handles `charge.refunded` (full refund only) and
  `charge.dispute.created` via `lib/refunds.ts`: guest spots become
  `refunded`/`disputed`, bookings `cancelled` (unless `used`), ticket orders
  `refunded`/`disputed`. Every admit, QR and wallet check refuses all three
  non-admitting statuses. **Action needed:** subscribe the Stripe webhook
  endpoint to `charge.refunded` and `charge.dispute.created`.
- **BK-09.** `lib/door.ts` sends `wrong_night` (Madrid night, 06:00
  rollover). `door/admit` won't record an admission for a cancelled,
  unpaid, unknown or wrong-night credential unless a `reason` (bouncer
  override) is given, and caps `count` at 50. Refusals answer
  `200 {recorded:false}`. **New door bug fixed:** one refused scan used to
  block the door app's whole offline queue forever; the door app now drops
  permanent 4xx refusals.
- **BK-11.** Checkout reopens the buyer's own open Stripe page, records a
  payment that landed, or releases an expired hold and sells again.
- **BK-17.** Cancel refused once the night is over. A failed refund writes
  `refund_failures` (new table).
- **BK-18.** Rate limits on checkout, claim and guest-list signup.
  Anonymous unpaid holds are capped at a quarter of the room.
- **BK-19.** `join-guestlist` returns the existing spot instead of a second.
- **BK-12 / BK-20 / BK-24.** The inbox reads the kind from the PDF name,
  merges only into a pending row of that kind, and takes night, venue,
  settle and price from the feed (a product named in the email decides an
  ambiguous list; still ambiguous → logged, filed as a guestlist).
- **BK-28.** Geofence check-in refuses unpaid, refunded and disputed spots.
- **BK-29.** Comment fixed.
- **BK-30.** `resolveBookingDate` and `/api/bookings` use Madrid nights
  (`lib/hours.currentNight`): tonight through +14, never a past night.

iPhone:
- **BK-14.** Closing checkout after the payment page asks "Did you finish
  paying?". On yes, the ticket is filed without a QR and the pass step
  waits for the inbox. Same if the confirmation page shows but no PDF can
  be read.
- **BK-15.** A private-relay email with the inbox off blocks booking
  (`fv.relayNoInbox`).
- **BK-16.** The pay button shows Fourvenues' quoted total (deposit or full,
  with fees), or "+ fees" until the quote is in.
- **BK-21.** Sync claims email-filed rows regardless of settle and corrects
  them to what the device knows.
- **BK-22.** Refusals map to our copy (`FVGuards.FVReject`); sold out
  refreshes the feed, already-on-list syncs.
- **BK-23.** `FVPhone.normalize`: `00`→`+`, +34 only for Spanish 9-digit
  numbers, otherwise ask (`fv.phoneHint`).
- **BK-26.** Under-age (birthday vs `minAge` on that night) blocks the
  booking (`fv.underAge`).
- **BK-27.** The feed's `Last-Modified` header is tracked; older than 3 h
  shows "Availability last checked …".
- **BK-31.** The inbox address is re-checked daily.
- **FV-U01.** After "sent, unconfirmed", the same way in is locked for 10
  minutes (`fv.checkingWithFV`).

Still open:
- **BK-10 (product decision).** Open-access `admit`/`void` still needs no
  device or event code on public nights. The refusals and count cap shrink
  the damage, but anyone holding a QR can still void a check-in or admit
  tonight's booking early. Fix: require enrollment or the night's event
  code on every night (door app change, plus a rollout plan for doors).
- **BK-25 (partly).** Raw messages are gone from every route touched here;
  other routes still return `err(e.message)`.
- ~~Web sheet sends no date~~ **fixed:** `RumbalistBookSheet` showed
  `plan.date` but booked "tomorrow"; it now sends `plan.date`.
- ~~Migration to apply~~ **applied to production 2026-10-05**, all three
  parts verified: `refund_failures` (service-role only),
  `bookings_stripe_payment_intent_uniq`, and
  `promoter_guests_payment_status_ck` including `'disputed'`.

---

## 2. S1: fix before the next release

### BK-01. The VIP table price is whatever the phone says
- `create-vip-intent` takes `amount` from the request body
  (`src/app/api/rumbalist/create-vip-intent/route.ts:17, 40`). The only rule
  is ≥ 50 cents. The app sends `offer.priceEur × 100`
  (`RumbalistOfferSheet.swift:651`).
- `confirm-vip` books whatever the intent was for:
  `total = intent.amount / 100` (`confirm-vip/route.ts:56`). It also takes
  `club_id` from the body without checking it against
  `intent.metadata.club_id` (`:68`).
- **Scenario:** a modified request creates a €0.50 intent, Apple Pay confirms
  it, and `confirm-vip` writes a `confirmed` VIP booking with a door QR.
  Variant: pay for the cheapest club's table and confirm it at Opium.
- **Fix:** the server looks the price up from `partner_offers` (club + kind +
  night) and ignores `amount`. Put `club_id`, `booking_date` and the expected
  amount in intent metadata. `confirm-vip` checks
  `intent.amount === expected`, `metadata.club_id === body.club_id`, and the
  booking date. Refuse otherwise.

### BK-02. A paid promoter night can be claimed for free
- `/promoter-invites/[token]/claim` never reads `price_cents` or the live
  release (`claim/route.ts:73`). The row it inserts gets the column default
  `payment_status = 'free'` (`20260820_paid_events.sql:113`).
- The door treats `free` as admissible: it only refuses `pending`/`refunded`
  (`door/admit/route.ts:192`, `lib/door.ts:386`). The wallet pass and QR
  routes do the same.
- **Scenario:** a guest takes the invite link for a €20 night and POSTs
  `{"full_name":"x"}` to `/claim` instead of `/checkout`. They get a valid QR
  and a Wallet pass, and the promoter is never paid.
- **Fix:** in `/claim`, compute `livePrice()` and return 409 *"This event is
  ticketed — buy your spot instead."* when > 0. Backstop in the DB: a trigger
  on `promoter_guests` insert that rejects `payment_status = 'free'` when the
  night is priced.

### BK-03. Legacy ticket orders: the client sets the price; any payment confirms any order
- `POST /api/tickets` takes `base_price_cents` and `quantity` from the body
  (`tickets/route.ts:30`). Sending `base_price_cents: 0` writes an order with
  `status: 'paid'` (`:37, :52`). A negative `quantity` gives a negative total
  (Stripe rejects it, but it isn't caught, so the route crashes with a 500).
  `currency` is client-chosen.
- `POST /api/tickets/confirm` checks that *some* intent succeeded, not that
  it's **this order's** intent, or the right amount or user
  (`tickets/confirm/route.ts:25`). Pay €1 for order A, then confirm order B
  (€300) with A's intent id.
- Orders are fulfilled by hand from an admin alert email. With admin
  accounts removed by design, check that someone actually receives it.
- **Fix:** if nothing calls this path, delete it. Otherwise: price from the
  server, `quantity` 1–10, and `confirm` requires
  `intent.id === order.stripe_payment_intent && intent.metadata.user_id === user.id`.

### BK-04. Legacy guest lists: check-in has no auth; signup accepts anything
`src/app/api/guest-lists/[id]/signup/route.ts`
- `PATCH` (`:95`) uses the service role with **no auth check at all**. Anyone
  can check any guest in or out with `{signup_id, checked_in}`.
- `POST`: `party_size` isn't validated (`:28`). A negative value lowers
  `signups_count` and reopens a full list; a huge one fills it. `tier` comes
  from the client (`:60`), so a guest can claim `vip`. `price_cents` is
  selected but never charged, so paid lists join free. No dedupe, no rate
  limit, no auth required. `cutoff_time` is never enforced.
- The count is bumped by hand "in case the trigger doesn't fire" (`:71`). If
  the trigger also fires, every signup counts twice and the list shows full
  at half capacity. Not atomic either: two joins at once both read the same
  count.
- The waitlist `position = signups_count + 1` is a head count, not a place in
  the queue.
- **Fix:** if nothing calls these routes, delete them. Otherwise: auth on
  PATCH (door device or club account), zod with `party_size` 1–10, `tier`
  from the list, refuse when `price_cents > 0`, and an atomic increment via
  RPC.

### BK-05. Account switch leaks Fourvenues tickets between users
- `FVTicketStore` is one file for the whole phone, and `AuthStore.signOut()`
  never clears it (`Stores/AuthStore.swift:427`).
- When B signs in, `FVAccountSync.sync` (`FVAccountSync.swift:73-118`)
  **removes** A's synced tickets from the phone and **inserts A's unsynced
  tickets into B's account** (`user_id = B`), door QR and PDF link included.
- `fv.phone` in UserDefaults (`FVEventSheet.swift:53`) isn't per user either,
  so B's paid checkout pre-fills A's phone number.
- **Fix:** keep the store file and `fv.phone` per user id, or wipe both on
  sign-out. Stamp the owner on each `FVTicket` and skip other owners' tickets
  in sync.

---

## 3. S2: guest stuck, charged without a ticket, or turned away wrongly

### BK-06. VIP: charged by Apple Pay, booking never written
`RumbalistOfferSheet.payVip` (`:633-680`) runs three steps: create intent →
Apple Pay confirms (**money moves**) → `confirm-vip` writes the booking.
Anything that breaks step 3 leaves the guest charged with no booking:
- the network drops or the app is killed between the steps;
- `confirm-vip` rejects the date **after** the charge (`resolveBookingDate`
  → 400 *"booking_date must be today or within the next 14 days"*);
- the insert fails.

The webhook has no path for these intents
(`payment_intent.succeeded` only handles `qr_token`/`event_name` metadata,
`webhooks/stripe/route.ts:206`). Nothing ever reconciles them. The guest sees
`error.localizedDescription` (`:676`).

**Fix:**
1. Validate everything (date, club, price) in `create-vip-intent`, before
   any money moves.
2. Put `source: rumbalist_vip` plus `booking_date`, `venue_name` and
   `product_name` in the intent metadata, and make the webhook write the
   booking idempotently on `stripe_payment_intent_id`. `confirm-vip` then
   just reads it back.
3. Client: on a step-3 failure, retry `confirm-vip` with backoff and show
   VIP-02 (§5). Never show a generic error after a successful charge.

### BK-07. Legacy club booking: charged with no row, double charges, stuck "pending"
`POST /api/bookings` (`bookings/route.ts:126-166`):
- It confirms the PaymentIntent **first**, then inserts. If the insert fails
  (`:166`), the guest is charged and the booking doesn't exist. There's no
  refund and no webhook rescue: `payment_intent.succeeded` only *updates* a
  row that isn't there.
- No `idempotencyKey`. A double tap or a client retry creates two intents
  and two charges.
- `allow_redirects: 'never'` with 3-D Secure → status `requires_action` →
  the row is saved as `pending` with a QR token, and nobody ever finishes it.
- **Fix:** insert `pending` first, create the intent with
  `idempotencyKey = booking.id`, and let the webhook confirm. Return
  `requires_action` + `client_secret` so the client can run 3-D Secure.

### BK-08. Refunds and chargebacks never reach the door
- `payment_status = 'refunded'` is honoured by the door, wallet and QR, but
  **nothing ever writes it**. The webhook has no `charge.refunded`,
  `charge.dispute.created` or `checkout.session.expired` case.
- **Scenario:** a promoter refunds a guest from their Stripe dashboard. The
  guest keeps a valid QR and Wallet pass and gets in anyway. A chargeback on
  a VIP table: the table stays `confirmed`.
- **Fix:** handle `charge.refunded` (full refund → `refunded` +
  `pushWalletUpdate`; partial → log only), `charge.dispute.created` (flag
  the row; the door shows "Payment disputed — ask the guest for ID"), and
  Connect events (`account` header) so promoter-side refunds arrive too.

### BK-09. Door: no "wrong night"; cancelled bookings still get admitted
- `ios-door` has a **WRONG NIGHT** screen (`AccessResultView.swift:20`), but
  the server never sends `wrong_night`/`wrong_venue`. `resolveDescriptor`
  only produces ok, over or cancelled (`lib/door.ts:333`). A booking for
  next Saturday scans **OK** tonight, at any venue.
- `admit` records the admission even when `ctx.status === 'cancelled'`. It
  just skips the `used` flag (`door/admit/route.ts:112`). A cancelled,
  refunded booking still counts as admitted, and the club gets billed.
- **Fix:** in `resolveDescriptor`, compare the night with tonight in
  Madrid, where tonight runs until 06:00 (`wrong_night`), and the club with
  the door's venue (`wrong_venue`). In `admit`, refuse
  cancelled/wrong-night with 409 unless `reason` is set (a deliberate
  bouncer override, logged).

### BK-10. Door: anyone can admit or void
"Just allow anyone to scan/void" (`door/resolve/route.ts:12`) was a choice
made while there were no partner clubs. The consequences:
- `void` with any `scan_id` and a known `token_ref` drops a guest's net count
  to 0 and clears their check-in.
- `admit` with `count: 20` on someone's `bk_<id>` marks the booking `used`
  before they arrive. They're then shown as **already used** at the door.
- Every bogus admit lands in the overscan ledger that clubs get billed from.

`token_ref` is the booking or guest UUID, which is printed in every QR, so
anyone who has seen a guest's QR has it.
**Fix:** require an enrolled device (`door/enroll` exists) or a night event
code for `admit`/`void` on every night, not just private ones. Cap `count`
at the remaining allowance.

### BK-11. Promoter checkout: abandon Stripe, come back, locked out
The unique index `(allocation_id, claimed_by_user)`
(`promoter_series.sql:37`) also covers **pending** rows. A signed-in guest
who backs out of Stripe and taps Buy again gets 23505 → *"You already have a
spot on this list"* (`checkout/route.ts:202`). They're held off until the
sweeper deletes the hold: 30 min hold + 30 min grace + up to 60 min for the
hourly cron, so **up to ~2 h**. On a selling-out night, that's the spot.
**Fix:** if the buyer has their own live `pending` row, return its existing
Stripe session URL (or expire it and open a new one). Never answer "you
already have a spot" for an unpaid hold.

### BK-12 – BK-16. Fourvenues (detail in §4)
BK-12 door-list money lost from email, BK-13 queue/captcha dead end, BK-14
paid then closed with no record, BK-15 relay accounts without the inbox,
BK-16 the CTA price.

---

## 4. Fourvenues / HypeList in detail

Fourvenues has no API for us: we drive their web form, read their JSON reply,
read their PDF and read their email. Any of those can change overnight.

**Where the evidence of a booking lives**, strongest first:

| # | Evidence | Source | Missing when |
|---|----------|--------|--------------|
| 1 | POST reply (`_id`, door code) | `wrapPost` in `FVJS.fillAndSubmit` | Free/door only. The paid flow never sees it |
| 2 | Ticket PDF → QR | Confirmation page, `FVTicketReader` | Checkout closed early, Bizum app switch, PDF layout change |
| 3 | Email → ticket inbox | `/api/inbound/resend` → `external_tickets` | Inbox off + relay email, sender not allowed, DMARC fail, daily cap |
| 4 | Guest's own email or bank statement | Guest | Never, but support has to step in |

**Rule:** never issue a ticket card without #1 or #2.

- **BK-12 (S2).** `fileTicket` sets
  `settle: isGuestlist ? 'free' : 'online'` (`inbound/resend/route.ts:212`).
  Door lists are `listas` too, so they're filed **free** and the "Pay €X at
  the door" warning disappears. Tables (`reservas-`) are filed `online` with
  price 0, so the balance is lost. **Fix:** take settle and price from the
  feed by `event_code` + PDF prefix, or use an `unknown` settle with a
  neutral card.
- **BK-13 (S2).** `challenge` → `needsForm` → `fv.cantComplete` "Try again in
  a moment" (`FVEventSheet.swift:777-783, 816-822`). Retrying can't succeed.
  **Fix:** treat `challenge` as its own case and open `FVCheckoutView`
  visibly so the guest clears it themselves (FV-Q01). Never try to solve or
  bypass it.
- **BK-14 (S2).** "Close" (`FVWeb.swift:586`) dismisses even after
  `visitedPayment`. `findTicket` gives up after 30 × 700 ms with nothing
  written. **Fix:** after visiting `pay.`, write a pending `external_tickets`
  row and ask "Did you finish paying?" (FV-P04).
- **BK-15 (S2).** `FVInbox.email` falls back to the account email when
  `TICKET_INBOX_ACTIVE` ≠ `true`. For Sign in with Apple that's a relay
  address Fourvenues can't reach. With BK-14 or a code-less reply, the guest
  has **no QR anywhere**. **Fix:** confirm the flag in production, and block
  paid bookings for relay accounts while it's off (FV-A03).
- **BK-16 (S2).** `ctaLabel` (`FVEventSheet.swift:643-649`) shows
  `p.price × quantity` even after `quote` has the real total. Example: the
  button says "Pay €20", the summary says €22.40, Apple Pay charges €22.40.
  **Fix:** use `quote.total` (or `now + fee` for tables), with "+ fees" until
  the quote arrives.
- **BK-20 (S3).** Pending-row merge matches on `event_code` only
  (`route.ts:194-200`). Guestlist + table on the same night → the table's QR
  can land on the guestlist card. **Fix:** match the PDF prefix to the kind
  (`listas`→free/door, `entradas`→online, `reservas`→table).
- **BK-21 (S3).** The email files a row with the QR before the app syncs.
  The app's claim needs settle to match (`FVAccountSync.swift:98-104`); with
  BK-12 it doesn't, so a second row with no QR is inserted. **Fix:** claim
  on `event_code + night` ignoring settle for `source='email'` rows.
- **BK-22 (S3).** The rejection reason is
  `document.body.innerText.slice(0, 300)` (`FVWeb.swift:213, 230-233`), shown
  verbatim (`FVEventSheet.swift:776, 814`). **Fix:** classify it (FV-R01–R05)
  and keep the raw text in the trace only.
- **BK-23 (S3).** `phone` (`FVEventSheet.swift:88-94`) puts `+34 ` in front
  of anything without `+`. **Fix:** `00`→`+`; only assume +34 for 9 digits
  starting with 6–9; otherwise ask for the country.
- **BK-24 (S3).** `night: p.night ?? new Date().toISOString().slice(0,10)`
  (`route.ts:211`) uses the UTC arrival date. **Fix:** take the night from
  the feed by `event_code`, else leave it undated.
- **BK-26 (S3).** `minAge` is shown but never checked against `birthday`.
  **Fix:** disable the CTA (FV-F05).
- **BK-27 (S3).** Feed lag can reach ~2 h (1 h cron + 5 min CDN + 1 h app
  `maxAge`), with no "last checked" anywhere. A sold-out product fails as
  `cantComplete`. **Fix:** compare the feed's `run` timestamp (FV-F02) and
  classify sold-out (FV-R02), then `refresh(force: true)`.
- **BK-31 (S4).** `FVInbox` caches the address in UserDefaults forever
  (`FVAccountSync.swift:153`). **Fix:** re-check `active` daily.

---

## 5. Error catalogue: what the guest sees

Codes are for traces and support; guests never see them. New copy goes in
`gen-xcstrings.js` `NATIVE_KEYS` (en/es; ca/fr in
`translations-ca-fr.json`). *Existing* means the key already ships.

### Fourvenues: before tapping

| Code | Trigger | Guest sees (en / es) | App does |
|------|---------|----------------------|----------|
| FV-F01 | `feed decode failed` | Nothing; last good feed stays | Ops: check the agentbox cron |
| FV-F02 | Feed `run` older than 3 h | **"Availability last checked %@. It may have changed."** / **"Disponibilidad comprobada a las %@. Puede haber cambiado."** | Still books |
| FV-F03 | `sold_out` in feed | *Existing* `fv.soldOut` | Row disabled |
| FV-F04 | Sold out live, not in the feed | **"That just sold out. Pick another way in."** / **"Se acaba de agotar. Elige otra opción."** | Force-refresh the feed |
| FV-F05 | Age < `minAge` | **"This night is %d+. Fourvenues and the door will check ID."** / **"Esta noche es para mayores de %d. Fourvenues y la puerta pedirán DNI."** | CTA disabled |

### Fourvenues: account

| Code | Trigger | Guest sees | App does |
|------|---------|-----------|----------|
| FV-A01 | No name on profile | **"Add your name to your profile — it goes on the ticket."** / **"Añade tu nombre al perfil: aparece en la entrada."** | Button to Profile |
| FV-A02 | Phone invalid after normalising | **"Include the country code, e.g. +44 7700 900123."** / **"Incluye el prefijo del país, p. ej. +34 612 345 678."** | CTA disabled |
| FV-A03 | Relay email + inbox off | **"Your Apple sign-in hides your email, so Fourvenues can't send your ticket. Add an email in Profile to book."** / **"Tu inicio de sesión con Apple oculta tu email y Fourvenues no puede enviarte la entrada. Añade un email en tu perfil para reservar."** | Block paid |

### Fourvenues: background sign-up (free and door)

| Code | `fillAndSubmit` → | Guest sees | Ticket? |
|------|-------------------|-----------|---------|
| FV-S00 | `ok` + code | `fv.youreIn` / `rumbalist.onDoorList` + QR | Yes |
| FV-S01 | `ok`, PDF, no code | Same; the QR arrives a beat later | Yes |
| FV-S02 | `ok`, nothing | Same + *existing* `fv.qrInEmail` | Yes, QR pending |
| FV-U01 | `sent` | *Existing* `fv.unconfirmed`; CTA locked 10 min: **"Checking with Fourvenues…"** / **"Comprobando con Fourvenues…"** | No, but maybe on the list |
| FV-R01 | `ya estás apuntad\|already (signed\|registered)` | **"You're already on this list. Your ticket is in Tickets or your email."** / **"Ya estás en esta lista. Tu entrada está en Entradas o en tu email."** | Sync, then focus it |
| FV-R02 | `completo\|agotad\|sold out\|no quedan` | FV-F04 copy | No |
| FV-R03 | `superando el l[ií]mite` | **"That's more than this list allows per person. Try fewer people."** / **"Supera el máximo por persona de esta lista. Prueba con menos personas."** | No |
| FV-R04 | `algo ha pasado` | *Existing* `fv.cantComplete` | No; retry is safe |
| FV-R05 | Other `error` | *Existing* `fv.rejected` | No |
| FV-Q01 | `challenge` | **"Fourvenues is checking you're not a bot. Continue on their page — it takes a few seconds."** / **"Fourvenues está comprobando que no eres un bot. Continúa en su página, solo tarda unos segundos."** | From the visible page |
| FV-L01 | `needsForm("load")` | **"Can't reach Fourvenues. Check your connection and try again."** / **"No podemos conectar con Fourvenues. Revisa tu conexión e inténtalo de nuevo."** | No |
| FV-L02 | `noform` / `script` | *Existing* `fv.cantComplete` | No: their page changed |
| FV-L03 | `disabled {empty:[field-x]}` | *Existing* `fv.cantComplete` | No: **new required field**, P4 same day |

### Fourvenues: paid

| Code | Stage | Guest sees | Ticket? |
|------|-------|-----------|---------|
| FV-P01 | `payURL` → `error` | Classify as R01–R05 | No; nothing charged |
| FV-P02 | `payURL` → other | *Existing* `fv.cantComplete` | No; nothing charged |
| FV-P03 | Close before `pay.` | Back to review | No; nothing charged |
| FV-P04 | Close after `pay.` | Confirm: **"Did you finish paying? If you did, your ticket will arrive by email and appear here."** / **"¿Has terminado de pagar? Si es así, tu entrada llegará por email y aparecerá aquí."** [Keep waiting] [Close] | Pending row |
| FV-P05 | PDF not found after return | Same as P04 | Pending row |
| FV-P06/07 | Page expired / card declined | Fourvenues' own page | No |

### Club Fuoco server routes (VIP, Rumbalist, promoter, legacy)

Today, many routes return raw `e.message` (BK-25). Map them to these instead
and log the raw message server-side.

| Code | Route / condition | HTTP | Guest sees (en / es) |
|------|-------------------|------|----------------------|
| VIP-01 | `create-vip-intent` Stripe error | 402 | **"We couldn't start the payment. You haven't been charged."** / **"No hemos podido iniciar el pago. No se te ha cobrado."** |
| VIP-02 | `confirm-vip` fails **after** Apple Pay | — | **"Payment received — we're saving your table. Don't pay again; it'll appear in Tickets shortly."** / **"Pago recibido: estamos guardando tu mesa. No vuelvas a pagar; aparecerá en Entradas en breve."** (retry in the background; P5 if it doesn't land) |
| VIP-03 | `confirm-vip` status ≠ succeeded | 402 | **"The payment didn't go through. You haven't been charged."** / **"El pago no se ha completado. No se te ha cobrado."** |
| VIP-04 | Price or club mismatch (after the BK-01 fix) | 409 | **"This table's price changed. Check the new price and try again."** / **"El precio de esta mesa ha cambiado. Revisa el nuevo precio e inténtalo de nuevo."** |
| GL-01 | `join-guestlist` not running that night | 409 | *Server already says:* "This guestlist isn't running on that night." → es **"Esta lista no está activa esa noche."** |
| GL-02 | `join-guestlist` full | 409 | "This guestlist is full for that night." → es **"Esta lista está completa para esa noche."** |
| GL-03 | Bad or old date | 400 | **"Pick a night in the next two weeks."** / **"Elige una noche dentro de las próximas dos semanas."** |
| GL-04 | Already joined (after the BK-19 fix) | 409 | **"You're already on this list."** / **"Ya estás en esta lista."** |
| PN-01 | checkout: releases spent | 409 | "Tickets for this event have sold out." / **"Las entradas para este evento se han agotado."** |
| PN-02 | checkout: promoter can't charge | 409 | "This event can't take payments yet…" / **"Este evento aún no puede cobrar. Pide al promotor que complete su configuración de pagos."** |
| PN-03 | Not enough spots (23514) | 409 | "Not enough spots left" / **"No quedan plazas suficientes."** |
| PN-04 | Own pending hold (after the BK-11 fix) | 200 | Reopen their Stripe page. No message |
| PN-05 | Already paid | 200 | `alreadyPaid` → open their ticket |
| PN-06 | Stripe refused the session | 502 | "Couldn't start checkout. Please try again." / **"No hemos podido iniciar el pago. Inténtalo de nuevo."** |
| PN-07 | `verify-payment` Stripe down | 502 | "Couldn't confirm the payment yet. Give it a moment." / **"Aún no hemos podido confirmar el pago. Espera un momento."** |
| PN-08 | `/claim` on a priced night (after the BK-02 fix) | 409 | **"This event is ticketed — buy your spot instead."** / **"Este evento es de pago: compra tu entrada."** |
| BKG-01 | Legacy cancel: refund failed | 200 | Today: "Refund will be processed manually", with no queue behind it. Write a `refund_failures` row and say: **"Cancelled. Your refund is delayed — we'll email you when it's sent."** / **"Cancelada. Tu reembolso se ha retrasado; te avisaremos por email cuando se envíe."** |

### Door (`ios-door`)

| Status | Shown | When (after the BK-09 fix) | Bouncer protocol |
|--------|-------|----------------------------|------------------|
| `ok` | ADMIT | Right night, right venue, paid/free, under allowance | Admit |
| `over` | OVER | All heads already admitted | Refuse; the holder can show who's still outside |
| `already_used` | USED | Single ticket already scanned | Refuse. If they insist, P7 |
| `cancelled` | CANCELLED | Cancelled, refunded, or unpaid hold | Refuse; send them to the promoter or the app |
| `wrong_night` | WRONG NIGHT | Night ≠ tonight (06:00 rollover, Madrid) | Refuse; show the date on the ticket |
| `wrong_venue` | — | Booking for another club | Refuse |
| `invalid` | Unknown code | Not ours | Fourvenues QR? Use their scanner (Fourvenues entries aren't in our tables) |

---

## 6. Support protocols

Service-role SQL in the Supabase SQL editor; device trace at
`Library/Application Support/fv-trace.log` (no names or emails in it).

### P1. Fourvenues: "I signed up but there's no ticket / no QR"
1. `select id, email from users where email ilike '%…%';`
2. Account rows:
   ```sql
   select id, event_code, night, settle, qr_payload is not null as has_qr, source, created_at
   from external_tickets where user_id = :uid order by created_at desc limit 10;
   ```
3. Inbox:
   ```sql
   select received_at, from_address, subject, status, detail, ticket_id
   from ticket_inbox_messages where user_id = :uid order by received_at desc limit 10;
   ```
4. Branch:
   - **Row with QR** → the app hasn't synced. Pull to refresh, or sign out
     and back in.
   - **Row, no QR, no inbox message** → Fourvenues never emailed us. Check
     `ticket_inboxes` and `TICKET_INBOX_ACTIVE`. If the guest has the PDF,
     the code is in the filename (`listas-XXXX….pdf`):
     `update external_tickets set qr_payload='XXXX…' where id=:id;`
   - **Inbox `no_ticket` / `error`** → `blocked: sender` means allow-list the
     domain if it's real Fourvenues; `unauthenticated` means never allow-list;
     `daily cap` means rotate the token (delete the `ticket_inboxes` row, the
     app clears `fv.inbox.<uid>`); `no Fourvenues ticket link` means the
     template changed. To replay, delete the `ticket_inbox_messages` row and
     resend from the Resend dashboard.
   - **Nothing, trace says `sent, unconfirmed`** → only HypeList can say
     whether they're on the list. Don't re-submit for them.
5. Never say "you're on the list" without a QR or Fourvenues confirming it.

### P2. Fourvenues: "I paid but there's no ticket"
1. P1 steps 1–3. An inbox `filed` row means it's solved on the next sync.
2. No email after 30 min → spam folder, and which address they gave
   (relay?). The `pay.fourvenues.com` receipt is their proof.
3. Refunds go to **Fourvenues / the organiser**. We never hold that money.
4. Charged twice: look for two `entradas-`/`reservas-` codes on one
   `event_code`. Both are real; the organiser refunds one. Log it as a
   double-submit bug.

### P3. Fourvenues: door disputes over money owed
`door` settle owes `unit_price × heads`. A table on deposit owes
`unit_price − paidNow` (device only). `source='email'` rows have unreliable
settle and price (BK-12): the Fourvenues email is the authority.

### P4. Fourvenues changed something (many guests failing at once)
Signals: a burst of `disabled {…}`, `noform`, `feed decode failed`, or
`no Fourvenues ticket link`.
1. Pull a trace from Yakov's phone on a live event.
2. `empty:[…]` means a new field; `noform` means the field ids changed. Both
   need an app release.
3. Until the release is out, mark the affected products `sold_out` in the
   mapper so guests aren't sent into a dead end.
4. Email template changes are server-only: update `parseTicketEmail` and
   replay.

### P5. VIP: "Apple Pay charged me but there's no table"
1. Stripe dashboard → Payments → search the guest's email. Look for intents
   with `metadata.source = rumbalist_vip`, `user_id = :uid`.
2. `select * from bookings where stripe_payment_intent_id = 'pi_…';`
3. **No row** → BK-06. Until the webhook fix ships, either replay
   `confirm-vip` for them (same `payment_intent_id`, `club_id` from
   metadata; it's idempotent), or refund in full from the dashboard. Don't
   make the guest pay again.
4. **Amount looks wrong** (e.g. €0.50 for a table) → BK-01 abuse. Don't
   honour it at the door: cancel the booking, refund, and flag the account.

### P6. Refund or chargeback on a Stripe-paid spot (until BK-08 ships)
1. Promoter-night refund: by hand,
   `update promoter_guests set payment_status='refunded' where stripe_payment_intent_id='pi_…';`
   then make sure the Wallet pass push goes out.
2. VIP/legacy refund: `update bookings set status='cancelled' where stripe_payment_intent_id='pi_…';`
3. Chargeback: same as above, plus a note to the venue. On Connect
   (`on_behalf_of`) the promoter's balance carries it; on platform VIP
   charges, **we** do.

### P7. Door: guest says "I haven't been in" but it scans USED/OVER
1. `select * from admission_scans where token_ref = 'bk_…' or token_ref = 'pg_…' order by device_time;`
2. Admissions from an unexpected device or time → BK-10 griefing, or a
   shared screenshot. Void the bogus scans from the door app and admit.
3. Same QR used twice → a screenshot passed to a friend. Admit only the
   first person.

### P8. Promoter night: "It says I already have a spot but I didn't pay"
BK-11. Until the fix ships:
```sql
delete from promoter_guests
where allocation_id = :alloc and claimed_by_user = :uid and payment_status = 'pending';
```
Then the guest taps Buy again. Check first in Stripe that the session wasn't
paid; if it was, run `verify-payment` instead.

### P9. Legacy booking: charged, no booking (BK-07)
Look up the intent by `metadata.qr_token`. If no `bookings` row has that
`stripe_payment_intent_id`, refund in full. Don't recreate the booking by
hand unless the night is still ahead and the guest wants it.

---

## 7. Unverified: needs a real test

- **Fourvenues group codes:** one door code per group or per head?
  `parseTicketEmail` files only `codes[0]`; if it's per head, friends' QRs
  are dropped.
- **Fourvenues payment hold:** how long before the payment page expires
  (FV-P06)?
- **Fourvenues sold-out wording:** FV-R02's pattern is a guess beyond
  `completo`/`agotado`.
- **Fourvenues refusals:** does a refused sign-up ever return an `_id` (a
  false S00)?
- **4-char event codes:** all 157 in the sample are 4 characters, and
  `eventCode = codes[0].slice(0, 4)` relies on that.
- **`guest_lists` trigger:** does production have the `signups_count`
  trigger (does BK-04 double-count)? Production drifts from
  `supabase/migrations`; check the live catalog.
- **Legacy callers:** do `/api/tickets`, `/api/bookings` POST and
  `/api/guest-lists/*/signup` still have any caller (web pages, old app
  builds)? If not, delete them rather than fix them.
- **Production flags:** `TICKET_INBOX_ACTIVE` and the `CRON_SECRET` value.
  `sweep-holds` skips auth when `CRON_SECRET` is unset.
