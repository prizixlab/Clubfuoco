# Fuoco Door — scanner app plan

**Status:** planning draft (2026-08-05). Nothing built yet.
**App:** Fuoco Door · `com.clubfuoco.door` · new `ios-door/` project (3rd iOS app).
**Builds on:** [`docs/overscan-enforcement-scope.md`](./overscan-enforcement-scope.md)
— which already _decided_ a distinct door scanner app and the admission-counting
model. This doc specifies **the app itself**: the scan → access → void loop and
the offline/sync contract the user asked for.

---

## 1. What the app is

A staff-facing QR scanner used at a venue door. A bouncer opens it for tonight's
door, points it at each guest's QR, and instantly sees **what that person is
entitled to** and whether it's still valid. It records each admission against an
allowance (this is what makes the overscan clause enforceable), works with **no
signal**, and **force-syncs at least every 12 hours**.

Three hard requirements from the product decision:
1. **On scan → show what they have access to.**
2. **Void requires a deliberate swipe** on the result (no accidental voids).
3. **Offline-capable, but must complete a full data transfer at least once
   every 12 h** — or it locks until it can.

---

## 2. Scan → Access screen (requirement 1)

### What a QR can resolve to
The scanner must accept any Club Fuoco credential and normalise it to one
**Access Descriptor**. Sources that exist today:

| Credential | QR payload | Entitlement shown |
|---|---|---|
| Paid booking (general / VIP) | `bookings.qr_code_token` | party_size, VIP table, arrival window |
| Free guestlist spot | `promoter_guests` id / invite token | name + plus-ones, promoter |
| Event ticket | `ticket_orders` (future QR) | quantity |
| Membership (optional) | member token | tier (gold/sapphire/black) perks |

The client sends the raw payload to **one resolve endpoint** and gets back a
uniform descriptor — the app never needs to know which table it came from.

### Access Descriptor (server → app)
```
{
  holderName, holderAvatarUrl,
  kind: "paid_entry" | "vip_table" | "guestlist" | "ticket" | "membership",
  entitlement: { label, partySize | plusOnes | quantity, extras[] },
  allowance: { used, allowed },        // e.g. 3 of 4 admitted
  status: "ok" | "already_used" | "over" | "cancelled" | "invalid" | "wrong_night",
  venue, night, tokenRef               // tokenRef = what a later void refers to
}
```

### The screen
- **Big verdict band** — green **ADMIT**, amber **⚠ OVER (5 of 4)**, red
  **INVALID / CANCELLED**. Colour + text + haptic; readable in the dark at a door.
- **Holder**: name, avatar, entitlement label ("VIP table · party of 6",
  "Guestlist +2", "Gold member").
- **Counter**: `used / allowed` after this admission.
- **Primary action**: `Admit` (records the admission). For a party, a stepper —
  "how many entering now" — so a party of 4 can enter across several scans and
  the count is exact (this is the admission signal overscan billing needs).
- Auto-returns to the live camera after N seconds so the queue keeps moving.

---

## 3. Void (requirement 2 — swipe to void)

A scan/admission just recorded can be **voided** — a mis-scan, wrong person,
double count, or a guest turned away after scanning.

- **Gesture:** the void control is a **swipe-to-confirm** track (like slide-to-
  power-off), _not_ a tap. Rationale: a void reverses money/allowance state, so
  it must be intentional — a tap is too easy to hit by accident at a crowded door.
- **What it does:** decrements the admission count / clears the check-in for
  `tokenRef`, and writes a `void` record (who, when, device, reason optional).
  Idempotent — voiding an already-voided scan is a no-op.
- **Where:** available on the result screen right after a scan, and from the
  **recent-scans list** (last N admissions this session) via a left-swipe row
  action that reveals the same slide-to-void track.
- **Offline:** a void is queued exactly like a scan and reconciled on sync
  (§4). Local counters update immediately so the door sees truth in real time.

---

## 4. Offline mode + forced 12-hour sync (requirement 3)

Doors have flaky signal, so scanning **cannot depend on the network** — but an
unbounded offline window is unsafe (stale allowances, un-reported overscans, a
lost/stolen device scanning forever). The resolution: **local-first with a hard
12-hour sync ceiling.**

### Local-first operation
- On going on-shift (online), the app pulls a **night manifest**: every valid
  token for this venue/night with its allowance, plus holder display info,
  signed by the server. Cached in local encrypted storage (SQLite/CoreData).
- **Scans validate against the local manifest** → instant verdict with no
  round-trip. Each admission/void is appended to a **local, append-only queue**
  (persisted, survives app kill / battery death).
- Local counters are authoritative _for the UI_ during the shift; the server
  reconciles on sync and is the source of truth for billing.

### The 12-hour rule (the ceiling)
- The app tracks `lastFullSyncAt`. A **full data transfer** = push the entire
  queued scan/void log **and** pull a fresh manifest, both succeeding.
- If `now − lastFullSyncAt ≥ 12 h`, the app **locks scanning** and shows
  "Connect to the internet to keep scanning — last sync Xh ago." It keeps the
  queued data safe but refuses new scans until a full sync completes.
- Soft warnings before the ceiling (e.g. amber banner from 9 h) so staff sync
  before they're blocked mid-shift.
- Background/opportunistic sync whenever connectivity returns, so in practice the
  ceiling is rarely hit — it's a safety backstop, not the normal path.

### Sync protocol
- **Push:** bulk-POST queued scans/voids. Each carries a client-generated
  `scanId` (idempotency key) + monotonic device timestamp → server dedupes and
  reconciles, returns per-item accepted/rejected (e.g. rejected = allowance
  already exceeded by another door → flagged as overscan, not silently dropped).
- **Pull:** refreshed manifest (allowances may have changed — new bookings,
  cancellations) + server time (to correct device clock drift).
- **Multi-door reconciliation:** two doors offline can both admit against the
  same allowance; the **server** is where overscan is finally computed on merge,
  matching the scope doc's "confirmed admissions, de-duplicated" model.

### Trust / security
- Manifest is **signed**; the app rejects tampered caches.
- **Device enrollment**: each door device is enrolled to a venue with a
  revocable credential; the 12 h lock means a lost device stops being useful
  within half a day even fully offline.
- Local store encrypted; queue retained until the server acks it, then pruned.

---

## 5. Server work (new)

Mostly greenfield, aligned with the scope doc's Phase A:
- `admission_scans` log (booking/guest ref, door device, count, ts, `scanId`
  idempotency, voided flag) — the de-duped admission ledger.
- `bookings.admissions_allowed` (+ derive for guestlist/tickets) — the allowance.
- `door_devices` enrollment + revocation; door-staff auth (see open decisions).
- Endpoints:
  - `POST /api/door/enroll` — enroll a device to a venue.
  - `GET  /api/door/manifest?venue&date` — signed allowances + holder info.
  - `POST /api/door/scan` — resolve token + record one admission (idempotent).
  - `POST /api/door/void` — void a `tokenRef`/`scanId`.
  - `POST /api/door/sync` — bulk push queued scans/voids, pull manifest + time.
- The existing `POST /api/bookings/verify/[token]` is vestigial + single-scan;
  it's **replaced** by `/api/door/scan` (count-based, not status-flip).

---

## 6. Auth (open decision, from scope doc)

Recommended: Supabase **`club_staff`** accounts provisioned per venue from the
portal — the verify endpoint already gates on
`requireRole(['club_staff','club_owner','admin'])`, so there's a role model to
extend. Device enrollment binds a physical door device to that venue.

---

## 7. Phasing

- **Phase A — detection (no charging):** door app + scan/access/void loop +
  offline + 12 h sync + admission ledger + dedupe. Useful on its own (real door
  control + attendance truth), and produces the overscan data.
- **Phase B — enforcement (charging):** only if Phase A shows real overscan
  volume. Stripe off-session charge + 30-day notice / receipt / 14-day dispute,
  per the Terms clause and the scope doc's safeguards.

---

## 8. Open decisions to confirm before building

1. **Void reason** — capture an optional reason on void (audit), or friction-free?
2. **12 h lock hardness** — hard block, or degraded "scan but flag unverified"
   after 12 h? (Recommend hard block: it's the anti-abuse point.)
3. **Party admission UX** — one scan admits the whole party vs. count-per-head
   stepper. Per-head is what makes overscan exact; confirm door staff will do it.
4. **Auth mechanism** — per-venue `club_staff` logins vs. a simpler enrolled-
   device PIN.
5. **Which credentials v1** — start with paid bookings + guestlist (both exist),
   defer tickets/membership.
```
