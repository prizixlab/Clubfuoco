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
observe an overscan. Making it real is **mostly greenfield**. **Decided:** the
door surface is a **distinct QR scanner app** (a third iOS app, staff-facing),
not the promoter app and not per-head QR. Recommended path: build **Phase A
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

## Scanner surface — DECIDED: a distinct door app

The clause only has a signal if the door **scans once per person**. **Decision
(4 Aug 2026): build a distinct QR scanner app** — a third iOS app alongside the
consumer app (`ios-native`, com.clubfuoco.app) and the promoter app
(`ios-promoters`, com.clubfuoco.promoters). Rejected alternatives: reusing the
promoter app (conflates promoter self-service with door control), a portal
webcam scanner (clunky at a door), and per-head QR (moves the problem to
issuance/UX). Everything below assumes **"door staff scan once per head against
an allowance."**

### The door app (working name "Fuoco Door", `com.clubfuoco.door`)
- **Own Xcode project + bundle id + release cadence**, mirroring how
  `ios-promoters` is set up (xcodegen `project.yml`, its own scheme). New
  directory e.g. `ios-door/`.
- **Scanning:** VisionKit `DataScannerViewController` (live camera QR, iOS 16+)
  or an AVFoundation `AVCaptureMetadataOutput` fallback. Decode the
  `qr_code_token`, POST to the redesigned verify endpoint, show the bouncer a
  big **covered / ⚠️ over** result with running `used/allowed`.
- **Scoped to a venue/night:** the app must know which door it is, so scans carry
  a `device_id`/door and a venue context (drives the de-dupe window and the
  overscan report).
- **Offline tolerance (later):** doors have flaky signal; a queue-and-sync of
  scans is a Phase A+ nice-to-have, not v1.

### New open decision — how door staff authenticate
The scanner is a **new auth surface**. Note the existing verify endpoint already
gates on `requireRole(['club_staff','club_owner','admin'])`, so there is a role
model to build on. Options:

| Option | What it means | Trade-off |
| --- | --- | --- |
| **Supabase `club_staff` accounts** (leans on what exists) | Portal provisions per-venue door logins; app signs in with Supabase auth; verify endpoint's existing role check already fits | Reuses infra; but per-venue account admin + memory notes "web app has no admin accounts" — this adds a staff account class |
| **Venue device login / PIN** | A venue-scoped credential the operator sets; device stays logged in | Simple at the door; weaker per-person accountability |
| **Per-night operator code** | Portal issues a short-lived code the door enters that night | Nothing persistent to manage; re-issue every night |

Recommendation: **Supabase `club_staff` accounts, provisioned per venue from the
portal** — it slots into the existing role gate and gives a real `scanned_by`
for the audit log. Confirm with Yakov before building.

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
Build the distinct **Fuoco Door** app (see "Scanner surface" above): new
`ios-door/` Xcode project, VisionKit live-camera QR, staff auth (pending the
auth decision), scan → verify → show a clear **covered / ⚠️ over** state.

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
- **Scanner surface is decided** (distinct door app); the remaining blocker is
  the **staff auth decision** — no auth → no `scanned_by` → weak audit trail.
- A **third app** is real ongoing cost: another Apple app record, provisioning
  profile, entitlements, review cycle, and release flow (see the promoter app's
  release notes for the pattern).
- **Prod schema drift:** both phases' migrations are manual SQL-editor applies;
  introspect the live catalog before trusting local DDL.
