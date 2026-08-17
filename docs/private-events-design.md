# Private events — design

**Status:** design, nothing built yet (2026-08-16).
**Scope:** three linked features requested together —
1. an invite link that survives the App Store install, landing in a stripped-down signup;
2. promoters charging for a private event;
3. **secured scanning** — a promoter-set event code that gates which scanners
   can admit, void, and cache the guest list.

They're one feature set because they share a spine: a private event is a night
whose guest list is reachable only through a link, whose spots may cost money,
and whose door is controlled by the promoter rather than by a venue.

---

## 0. What already exists

Attaching the design to what's actually shipped, since three of the four
surfaces already have most of the machinery.

**The invite link.** `/i/<token>` is a Universal Link (`public/.well-known/apple-app-site-association`
registers `/i/*` for `4V87UVPTBW.com.clubfuoco.app`). With the app installed,
`InviteLinkRouter` catches it and `RootView` presents `InviteClaimView`. Without
the app, `InviteClaimClient.tsx` renders a branded page — **web claiming was
retired**, so the page's only real action is "Get it on the App Store". Claiming
runs through `POST /api/promoter-invites/<token>/claim`, which mints a
`promoter_guests` row and tolerates anonymous callers.

**The night.** `promoter_nights` (club_id **nullable** — custom locations are
first-class) → `promoter_allocations` → `promoter_guests`. A guest's QR encodes
`fuoco-invite:<guestId>`; the uuid is the scanned secret.

**The door.** `ios-door` scans, resolves, admits, voids, and works offline. The
offline night pack (`GET /api/door/night`) is genuinely well built: every entry
is sealed with a key derived from that guest's own QR token (`src/lib/door-crypto.ts`),
so a stolen cache is a bag of ciphertext, not a guest list. Admissions land in
`admission_scans`, deduped on a client-generated `scan_id`.

**Door auth today is nothing.** `/api/door/resolve` and `/api/door/admit` are
deliberately unauthenticated — the comment says so: *"Deliberately UNauthenticated
while there are no partner clubs … the product decision: 'just allow anyone to
scan/void'."* `door_devices` + `/api/door/enroll` exist but only the
club-provisioned path uses them. Feature 3 is precisely the request to close this
for private events.

**Money.** `promoter_billing_accounts` bills promoters **for** front-page
promotion — money flows *from* promoters *to* us. There is **no Stripe Connect
account anywhere in the codebase**. There is currently no path by which money can
reach a promoter, so Feature 2 is the only one of the three that is greenfield
rather than an extension.

---

## 1. The blocking constraint: the door scopes itself by venue, and a private event has none

A guest on a custom-location night (`promoter_nights.club_id is null`) cannot be
admitted by the scanner today. This is **latent, not a live breakage** — see the
measurement below — and it is stopped deliberately, in a good place.

`resolveGuest()` tolerates a missing club and returns a descriptor with
`venue: ''`. The door then fails it closed, client-side, in `ScanController.scoped()`:

```swift
// Fail closed: an unset door venue, or a credential whose venue we
// couldn't resolve, must NOT be admitted. Previously an empty venue
// skipped the check entirely and showed ADMIT.
guard !door.isEmpty, !d.venue.isEmpty, d.venue == door else { … .wrongVenue }
```

So the bouncer sees **WRONG VENUE** — not a green ADMIT that silently fails to
record. The dangerous version of this was already found and fixed.

Behind that, a second stop: `admission_scans.club_id` is `uuid **not null**`, and
`tokenContext()` in `/api/door/admit` returns `null` — a 404 "Unknown token_ref" —
for a night with no club. You never reach it, because the client refuses first.

**Measured (2026-08-16, production):** 23 nights carry a `club_id`; exactly one
does not — a July 24 test at "Carrer de Pallars, 433" with zero allocations and
zero guests. No real guest has ever been turned away by this.

It stops being latent the moment private events exist, because a private event at
a warehouse is the *normal* case. And the deeper point is not "admit is broken" —
it's that **the door scopes itself by picking a venue, and a private event has no
venue to pick.** `buildManifest`, `/api/door/night` and `/api/door/venues` are all
keyed on `club_id` + date; the venue picker has nothing to show.

So the event code in Feature 3 is not only an auth gate. It is what gives a door a
scope at all. §1 and §3 only work together.

**Fix:** make the ledger keyable by night, not only by venue.

```sql
alter table admission_scans alter column club_id drop not null;
alter table admission_scans add column night_id uuid references promoter_nights(id) on delete cascade;
alter table admission_scans add constraint admission_scans_scope
  check (club_id is not null or night_id is not null);
create index admission_scans_night_idx on admission_scans(night_id, night_date);
```

`usedByToken()` gains a by-night variant; `tokenContext()` returns
`{ clubId: string | null, nightId: string }`. Club-hosted nights keep writing
`club_id` exactly as they do now, so nothing existing changes shape.

---

## 2. Feature 1 — the invite has to survive the App Store

### The problem, precisely

Universal Links only work if the app is already installed. The chain today is:
tap link → no app → branded page → App Store → install → **cold launch with no
token**. The intent is lost at the last step, and the guest lands in a generic
signup wizard with no idea what they were doing.

There is no Apple-provided deferred deep link. `pt`/`ct` App Store campaign
parameters are not readable by the app, and IDFA-style fingerprinting is dead.
Every solution is either explicit (the user hands us the token) or probabilistic
(we guess). So we do both, and never let a guess do anything irreversible.

### Channel A — clipboard handoff (deterministic)

Before navigating to the App Store, the web page writes
`https://clubfuoco.com/i/<token>` to the clipboard.

On first launch the app calls `UIPasteboard.general.detectPatterns(for: [.probableWebURL])`.
**This does not prompt** — it answers "is there a URL on the clipboard?" without
revealing it. Only if the answer is yes do we show our own card — *"Continue to
the invite you opened?"* — and only when the user taps it do we read the
pasteboard, which surfaces the familiar system paste prompt in a context where
it makes sense.

An `https://` URL is used rather than `clubfuoco://` specifically because
`detectPatterns` recognises the former.

This is deterministic when it works. It fails when the user copies something
else between tapping and launching, or declines the paste.

### Channel B — install match (probabilistic, silent)

The page also `POST`s `/api/invite-handoff` with the token before redirecting.
The server stores a short-lived ticket fingerprinted by hashed IP + platform +
coarse UA family, 30-minute TTL. On first launch the app `POST`s
`/api/invite-handoff/claim`; the server matches the same fingerprint, returns the
most recent unburnt ticket, and burns it.

This is the Branch-style match, and it is **wrong sometimes** — two people behind
one carrier NAT installing within the same half hour can cross. That is why:

> **A handoff only ever pre-fills. It never claims a spot, never joins a list,
> never spends money.** The worst case for a mis-match is that someone sees an
> event page they didn't ask for and closes it.

Ranked: Channel A wins when present, Channel B fills the gap, and a plain cold
launch with neither is the status quo.

### Channel C — the honest fallback

If both miss, the invite is still recoverable: the link is in the guest's
messages. Re-tapping it after install now hits the Universal Link and works.
This is worth saying out loud because it's the reason none of this needs to be
bulletproof.

### The reduced signup lane

When a token is pending, signup collapses to what a door legally and practically
needs:

| Field | In the lane? | Why |
|---|---|---|
| First name | **yes** | it's what the door list is checked against |
| Phone + OTP | **yes** | identity, and the only recovery channel |
| Birthday | **yes** | Club Fuoco is strictly 18+; `enforce_adult_birthday` is a hard DB trigger |
| Terms | **yes** | unavoidable |
| Email | deferred | |
| Gender | deferred | added for payout settlement, not needed to walk in |
| Onboarding survey | deferred | |

Birthday stays despite "bare essentials" because this is a nightlife product and
the spot being claimed is admission to a licensed venue. It is one drum-picker
screen. Everything else goes.

`UserProfile.isComplete` currently requires name + email + birthday + gender, and
`RootView` hard-blocks the app behind `CompleteProfileView` when it's false. The
lane needs a carve-out: **claim first, complete later.** A `pendingInviteToken`
lets the invite sheet through the gate; the next launch — or the first tap on
anything that isn't the invite — asks for the rest.

---

## 3. Feature 2 — charging for a private event

### The shape of the money

Guest pays → Stripe → promoter's connected account, minus our fee. That requires
**Stripe Connect Express** accounts, which do not exist yet.

- `promoter_payout_accounts` — one Connect Express account per promoter, with
  `charges_enabled` / `payouts_enabled` mirrored from the account webhook.
- Onboarding is a hosted Stripe link from the promoters app; **a promoter cannot
  price an event until `charges_enabled` is true.** This is a KYC wall, not a
  toggle — it takes real minutes and real documents, and the UI has to say so.
- Charges are **destination charges**: `transfer_data.destination` = the
  promoter's account, `application_fee_amount` = our take.
  `PLATFORM_FEE_PERCENT` is already 12% in `src/lib/stripe.ts`; reusing it keeps
  one number in one place.

### Claim becomes a two-phase commit

A free claim is one insert. A paid claim can't be, or a guest who abandons
checkout permanently eats a spot.

1. Claim creates the `promoter_guests` row with `payment_status = 'pending'` and
   a `hold_expires_at` 10 minutes out. Held rows count against capacity.
2. A `PaymentIntent` is created for the night's `price_cents × (1 + plus_ones)`.
3. `payment_intent.succeeded` on the existing `/api/webhooks/stripe` route flips
   the row to `'paid'`. **Only then is the QR issued and the Wallet pass
   downloadable.**
4. A sweeper releases expired holds.

The QR gate is the important line: `promoter-invites/guest/[guestId]/qr.svg` and
the wallet route must both refuse an unpaid row, or the money is optional.

### Apple's cut — the question that decides whether this ships

Admission to a real-world event is a **physical service**, explicitly outside
In-App Purchase (App Store Review Guideline 3.1.3(e) / 3.1.5(a) — "goods and
services consumed outside of the app"). Concerts, club nights and tickets are the
canonical example. So Stripe + Apple Pay is the correct and permitted rail, and
IAP would in fact be the *wrong* one.

Worth stating explicitly because it's the single highest rejection risk in this
feature set, and because the reviewer will see a purchase flow in a nightlife app
and look twice.

### Refunds

- Promoter-initiated refund per guest, from the guestlist screen.
- Automatic full refund to everyone when a night is cancelled or rejected in
  review — otherwise we're holding money for an event that will not happen.
- Refund reverses the application fee too; we don't keep a cut of a night that
  didn't run.

---

## 4. Feature 3 — secured scanning

> **Naming.** Called "secured scanning" everywhere a promoter can see it, never
> "private event". This whole flow is *already* the app's "Private event" type —
> the create chooser offers Private event vs Public offer, and TonightView
> labels every allocation "Private event" — and every promoter night is
> link-only regardless. A toggle offering privacy inside it reads as nonsense.
> What is actually new is the door. The stored value stays
> `visibility = 'private'` because it also hides the night from other
> promoters, but that name never reaches a screen.

### What it protects

The promoter sets a code when creating a private event. A scanner must enter it
to admit, void, or download that night's pack. This closes the open-access hole
for private events specifically, while club nights keep working as they do now.

The threat model is small and worth being precise about, because it decides how
much machinery is justified: **the code stops a stranger from admitting people to
someone else's private party.** It is a room key shared with a door team over
WhatsApp, not an account credential.

It notably does **not** need to protect guest identities, because the existing
per-entry sealing already does that — the night pack is unreadable without
physically scanning each QR. A leaked code buys the ability to admit, not a
guest list. That's a genuinely good property of the existing crypto and it means
the code can stay short and human.

### Design

- `promoter_nights.door_code` — 6 characters, unambiguous alphabet (no `O`/`0`,
  `I`/`1`). Stored readable to the owning promoter only, like a Wi-Fi password,
  because a code the promoter can't re-read is a code they'll rotate at 2am.
  One-tap rotation, which revokes every live session.
- `POST /api/door/event-code { code }` → a **night-scoped session token**, stored
  hashed in `door_event_sessions` (night_id, token_hash, expires_at, revoked_at),
  expiring at night end + 12h — the same 12-hour ceiling the door app already
  enforces.
- Redemption is rate-limited (`src/lib/ratelimit.ts` exists) — 5 attempts per
  minute per IP. The alphabet has 31 symbols (0/O and 1/I/L are all excluded
  rather than folded together), so 31⁶ ≈ 8.9e8 combinations sit behind a 5/min
  limit. Not brute-forceable in any useful time.
- `/api/door/night?night=<id>`, `/api/door/admit` and `/api/door/resolve` require
  that bearer **when the token belongs to a private night**. Public and
  club-hosted nights are untouched, so nothing that works today stops working.
- The door app gains a "join an event" path beside its venue picker, and the
  promoters app shows the code with rotate + share.

---

## 5. What breaks if this is done carelessly

The failure list, so the tests know what to aim at:

1. **A paid spot with a QR but no payment.** Every QR and Wallet path must gate
   on `payment_status`, not just the row's existence.
2. **A held spot that never releases**, silently shrinking capacity every time
   someone opens checkout and walks away.
3. **A double charge on retry** — the claim endpoint must be idempotent per
   (allocation, user), which the existing partial unique index already gives us.
4. **A mis-matched install handoff claiming a spot.** Prevented structurally:
   handoff pre-fills only.
5. **A private night silently scannable** because the door-code check was added
   to `/night` but not to `/admit`. Both, plus `/resolve`.
6. **Custom-location nights still un-admittable** — §1 must land before Feature 3
   means anything.
7. **A promoter pricing an event before Connect onboarding completes**, taking
   money into an account that can't receive it.
8. **A refund that doesn't reverse the application fee**, leaving us holding a
   cut of a cancelled night.

---

## 6. Build order

Sequenced so each step is independently shippable and verifiable in production.

| # | Step | Why here |
|---|---|---|
| 1 | Ledger by night (§1) | unblocks everything at custom locations |
| 2 | `visibility` + private nights, hidden from feeds | the noun the rest attaches to |
| 3 | Event code + night-scoped door sessions (Feature 3) | no new money, no new auth surface for guests |
| 4 | Invite handoff + reduced signup (Feature 1) | independent of 2–3, biggest funnel win |
| 5 | Stripe Connect onboarding (Feature 2a) | KYC wall — start it early, it gates 6 |
| 6 | Paid claims, holds, webhook, refunds (Feature 2b) | last, because it's the only irreversible one |

Steps 1–4 touch no money and can go out behind a flag. Step 6 is the one that
needs a real card, a real Connect account, and a production dry run before any
promoter sees it.
