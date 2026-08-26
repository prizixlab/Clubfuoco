# Release notes — August 2026

Copy into App Store Connect. Consumer goes in **What's New in This Version**
(4000 chars); promoters goes in **TestFlight → What to Test**.

---

## Club Fuoco 1.13 (34) — consumer, App Store

> **Version numbering.** The store is on `1.12`, not the semantic `1.2.x` this
> repo used to carry. Apple compares each component numerically, so `1.2.3` is
> LOWER than `1.12` and gets rejected at upload. Next one after this is `1.14`.

### What's New (paste as-is)

Dark mode is here. The whole app now follows your system appearance, or you can
pin it to light or dark in Settings.

Meet the DJs. Every DJ has their own page with the nights they're playing, and
a preview you can listen to before you decide. Club pages show who's on.

Events, in full. Line-ups credited artist by artist, descriptions, flyers,
start and end times, age policy and capacity — everything you need to pick a
night.

Your ticket, rebuilt. A full-screen QR that actually scans at the door, first
time, in a dark room.

Now in Catalan and French, alongside Spanish and English.

Promoter events can now be paid. Join for a price, or save the night for later
and decide closer to the day.

Invite links are smoother. Claim your spot first and sign in afterwards, and an
invite you tapped before installing survives the trip through the App Store.

Plus a lot of polish: a warmer membership card, a bigger save target on cards,
buttons that respond on the first tap, and fixes to booking cancellation.

### Submission checklist

- [ ] **App Review notes mention StoreKit membership tiers — the binary has no
      StoreKit.** `docs/app-review-login-note.md` claims "Membership tiers
      (StoreKit)". There is no `MembershipStore.swift` and no StoreKit import
      anywhere in `ios-native`. Remove that bullet from the ASC App Review
      Information, and make sure no in-app-purchase products are attached to
      this version, or review will look for a purchase flow that isn't there.
- [ ] **First build with external payments.** Joining a paid promoter event
      opens Stripe Checkout in Safari (`UIApplication.shared.open`). This is
      admission to a real-world event, exempt from IAP under 3.1.3(e)/3.1.5(a),
      but it is new in this build and may draw a reviewer question. The App
      Review notes should say the payment buys entry to a physical event.
- [ ] Sign-In Information set to `appletester@clubfuoco.com` (see
      `docs/app-review-login-note.md`).
- [ ] Screenshots refreshed — dark mode, DJ page and the rebuilt ticket screen
      are all new since the 1.12 shots.

---

## Fuoco For Promoters 1.1 (5) — TestFlight only

Not publicly released; `com.clubfuoco.promoters` returns nothing from the App
Store lookup. This build is for internal testing, so it needs no metadata,
screenshots or review pass.

### What to Test (paste as-is)

**Getting paid.** Set up payouts from the Earnings tab — Stripe's onboarding now
runs inside the app rather than bouncing you to Safari. Complete the identity
checks, then confirm the payouts screen shows your balance and buffer. You
cannot put a price on a night until Stripe has cleared you to receive money;
check that the price field stays locked until then.

**Private events.** Create an event that is link-only — it never appears in the
public feed. Read its door code from the event screen and check the code is what
the scanner at the door expects.

**Your branding on a guest's pass.** Upload a logo, or typeset a wordmark if you
don't have one, and pick a theme. Send yourself an invite and confirm the Wallet
pass a guest receives carries your branding, not Club Fuoco's flame.

**Two rates.** Public offers and private events are now priced differently.
Check the rate shown on each matches what you were told.

Please report anything where money, a price, or a payout reads wrong — those
matter more than cosmetic issues.
