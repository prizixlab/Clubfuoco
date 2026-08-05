# Overscan enforcement — scoping doc

**Status:** scoping only. Nothing here is built.
**Date:** 4 August 2026
**Context:** The consumer Terms of Use (`src/app/legal/terms/page.tsx`, "Bookings,
tickets and payments") now reserve the right to charge **up to €50 per admission
beyond the number a user paid for** on paid features (paid entry, fast pass, VIP,
paid tickets), based on *confirmed admissions* (not raw scans), with door-scan
double-taps de-duplicated, free guestlist excluded, and the same safeguards as
the no-show fee (30-day notice, receipt, 14-day dispute, "outside your control"
carve-out). This doc scopes the engineering to make that clause real.

---

## TL;DR

The clause is currently **unenforceable by construction** — the app has no way to
observe an overscan. Making it real is **mostly greenfield** and gated on one
product decision (who scans, and per head?). Recommended path: build **Phase A
(detection, no charging)** first — it's useful on its own and de-risks the rest —
and only build **Phase B (charging)** if Phase A shows real overscan volume.

---

## What exists today

- A `bookings` row is `booking_type` `general` or `vip`, carries `party_size`
  (1–20) and **one** `qr_code_token`. Event tickets are separate
  (`ticket_orders.quantity`). There is **no** `fast_pass` type yet.
- The only door-scan endpoint,
  [`POST /api/bookings/verify/[token]`](../src/app/api/bookings/verify/[token]/route.ts),
  flips the **whole booking** to `status:'used'` on the first scan and returns
  409 on the second. It is **single-scan-per-booking**: a party of 4 is admitted
  in one scan. No per-head counting, no scan log.
- **Nothing calls that endpoint.** No web, iOS consumer, or promoter-app client
  references it — there is **no scanner UI anywhere**. The consumer "Show this at
  the door" QR encodes `qr_code_token`, but in practice the door eyeballs it.
- The only *live* check-in is the promoter-guest **geofence** stamp
  (`promoter_guests.checked_in_at`, idempotent) — free-guestlist attribution, not
  paid-entry door control.

### Why the clause can't fire today
Overscan is either **impossible** (a 2nd scan of the same booking is 409'd) or
**invisible** (one scan admits the whole party, so the app never sees a 5th
person walk in). Enforcement requires changing the scan model from
"one-and-done" to "count admissions against an allowance" — and, first, a door
surface that actually scans.

---

## Gating decision (product, not engineering)

The clause only has a signal if the door **scans once per person**. That needs a
scanner surface that does not exist yet. Pick one before Phase A:

| Option | What it means | Trade-off |
| --- | --- | --- |
| **Promoter app as scanner** (recommended) | Add a camera-scan screen to FuocoPromoters; staff scan each head | Fastest — device, camera, auth already there; but only promoter-run doors |
| **Portal web scanner** | A `/portal` page that scans via webcam | Works for operator-run doors; clunky on a phone at a door |
| **Per-head QR** | Each guest in a party gets their own pass | Cleanest counting, no "count scans" logic; more issuance/UX work |

Everything below assumes **"staff scan once per head against an allowance."**

---

## Phase A — detection (no charging)

Ships the entire detection spine with **zero billing risk**, and produces the
data to decide whether Phase B is even worth it.

### Data model (migration, manual apply per the drift rule)
- `bookings.admissions_allowed int` (backfill = `party_size`; tickets =
  `quantity`). Retire the binary `status:'used'` gate in favour of counting.
- New table `admission_scans`:
  `id, booking_id, scanned_at, scanned_by (uid), device_id/door, counted bool,
  result text`. This is the audit log the clause's "confirmed admissions, not raw
  scans" wording depends on, and the dispute-evidence trail.

### Scanner surface
Per the gating decision — build the chosen one. Minimum: scan → call verify →
show the door a clear **covered / ⚠️ over** state.

### Endpoint redesign — `POST /api/bookings/verify/[token]`
- Insert an `admission_scans` row per scan; `admissions_used = count(counted)`.
- **De-dupe** (the "double-taps aren't charged" promise): a scan of the same
  token at the same device/door within a short window (e.g. 60s) is recorded but
  `counted:false`.
- Return `covered` (used ≤ allowed) vs `overscan` (used > allowed) plus the
  running `used/allowed`, so the bouncer sees "⚠️ 1 over — not paid for" and can
  decide to admit or not.

### Surfacing
- Promoter/portal: an overscan report per night for reconciliation.
- Consumer: change nothing that invites sharing; optionally show "admissions
  used 2/4" on the ticket.

**Exit criteria:** real doors scanning per head; overscan counts visible. Decide
Phase B from the numbers.

---

## Phase B — charging (only if Phase A shows volume)

- **Off-session Stripe charge** on the original payment method, €X per overscan
  up to the €50 cap. *Prereq:* confirm a reusable `payment_method` / Stripe
  customer is saved at booking time (verify — may not be today).
- **Clause promises to implement:** 30-day in-app notice + published activation
  date before the first charge; emailed receipt; 14-day dispute flow; a portal
  control to **waive/refund** for the "outside your control" carve-out.
- Free guestlist stays excluded **by construction** — only paid `bookings` /
  `ticket_orders` carry an allowance to exceed.

---

## Honest assessment / risks

- **Phase A is worth building regardless** — a real door scanner + admission
  counting is table-stakes for paid entry, and promoters will want it.
- **Phase B is heavy billing/compliance surface for a possibly-rare event.**
  Off-session charging EU consumers on a punitive-adjacent basis is exactly what
  gets scrutinised; gate it on Phase A data and a lawyer's review (the terms file
  already carries a "have a lawyer review before launch" note).
- **Everything is blocked on the gating decision.** No scanner surface → no
  signal → nothing to enforce.
- **Prod schema drift:** both phases' migrations are manual SQL-editor applies;
  introspect the live catalog before trusting local DDL.
