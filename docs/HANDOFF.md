# Club Fuoco — Engineering Handoff Memo

_Last updated: 2026-07-13. Covers the three client surfaces (consumer app,
Fuoco for Promoters, staff Partner Portal), their shared backend, current
architecture, and the known gaps/faults to pick up next._

---

## 0. System map

One **Next.js 15 app** (`~/Clubfuoco`, App Router, React 19) hosts the web
surfaces **and** every API route, deployed on **Vercel** (auto-deploys on push
to `main`, ~1 min). One **Supabase** project (`nqviodkapzjdkbgknauo`) provides
Postgres + Auth + Storage.

Three clients hit that backend:

| Client | Path | Stack | Auth |
|---|---|---|---|
| **Fuoco** (consumer) | `ios-native/` + web `src/app/(app)` | SwiftUI (Capacitor-free native) + Next web | Supabase (Google OAuth + email) |
| **Fuoco for Promoters** | `ios-promoters/FuocoPromoters/` | SwiftUI | Supabase email + password |
| **Partner Portal** (staff) | web `src/app/portal/**` | Next (client components) | Shared secret `PORTAL_PASSWORD` → httpOnly HMAC cookie |

### ⚠️ Operational rule #1 — schema drift
**Production Postgres drifts from `supabase/migrations/*`.** Migrations are
applied by hand in the Supabase SQL editor, not by a CLI. **Always introspect
the live catalog** (`/rest/v1/<table>?select=<col>&limit=1` with the service
key) before assuming a column exists — don't trust local DDL. As of this memo
**all migrations below are applied in prod** (verified), but new ones you write
will NOT be live until someone pastes them in.

### Migrations added recently (all applied ✅)
- `20260711_partner_attribution.sql` — `partner_brands.attribution_required/label` + `set_active_brand(uuid)` RPC
- `20260711_partner_offer_archive.sql` — `partner_offers.is_active` (deactivate ≠ delete)
- `20260711_partner_login_email.sql` — `partner_brands.login_email`
- `20260711_partner_brand_owner.sql` — `partner_brands.owner_user_id` → `users(id)`
- `20260712_portal_audit_log.sql` — `portal_audit_log` table
- `20260713_pending_changes.sql` — `pending_changes` approval-queue table
- `20260713_promoter_night_review.sql` — `promoter_nights/series.review_status` + `hold_promoter_submission()` BEFORE INSERT triggers

---

## 1. Backend data model (the partner/approval surface)

- **`partner_brands`** — the swappable front-page offer supplier ("lists" like Rumba). One `is_active` at a time (partial unique index `partner_brands_one_active`). Columns: `key` (immutable slug), `name`, `logo_url`, `color`, `attribution_required`, `attribution_label`, `login_email`, `owner_user_id`, `is_active`.
- **`partner_offers`** — per-club offers (`kind` free_guestlist|vip_table, title, subtitle, price_eur, party_size, time_window, `valid_days` (text), dress_code, music, sort_order, `is_active`). Public read; service-role writes.
- **`pending_changes`** — approval queue. Each row = an intended write (`action` offer.create/update/delete, `entity`, `target_id`, `payload` jsonb, `summary`, `status` pending/approved/rejected, `submitter_user_id`, `brand_id`). Live tables are untouched until approval. RLS: submitter reads own; service-role writes.
- **`portal_audit_log`** — append-only operator action log (`action`, `summary`, `target_type/id`, `meta`, `created_at`). Service-role only.
- **`promoter_applications`** — signup applications (instagram, ig_code, ig_verified, clubs, experience, `status`). Approving sets `users.is_promoter=true`.
- **`promoter_nights` / `promoter_series`** — promoter schedule. Now carry `review_status` (pending/approved/rejected). `promoter_nights.is_published` drives consumer visibility on the **discovery** feed only (NOT invite links).
- **`bookings`** + **`rumbalist_purchases`** — guest bookings (club_id, booking_type general/vip, status, checked_in_at, total_amount). Feed the portal Insights tab.
- **`clubs`** — ~1,700 venues, mostly Google-synced (photos/ratings/place_id read-only); operator-editable fields exposed in the portal Clubs tab.

### The approval system (built this session)
Two content types, one review surface:
- **Supplier offers** → `pending_changes` queue. `src/app/api/supplier/offers/**` enqueue instead of writing live (with a **graceful fallback**: if `pending_changes` is missing they write live — see `enqueueOrApplyDirect` in `src/lib/pending-changes.ts`). Approve → `applyChange` runs the real `createOffer/updateOffer/deleteOffer`.
- **Promoter nights/series** → `review_status` flag + `hold_promoter_submission()` trigger (forces `pending`/`is_published=false` for `authenticated` inserts; exempts `service_role`, so portal approvals and materialized series occurrences publish live). Gated at the **join boundary** (`src/lib/promoter-review.ts` — `nightBlocked/seriesBlocked/allocationBlocked`, all defensive so a missing column no-ops) in `resolveTokenToAllocation` (`src/lib/promoter-series.ts`) and `src/app/i/[token]/page.tsx`.
- **Portal Changes tab** (`/portal/reviews`) unions both; `POST /api/portal/reviews/[id]` dispatches on `type` (change|night|series).

---

## 2. Fuoco for Promoters (iOS) — `ios-promoters/FuocoPromoters/`

**Architecture.** SwiftUI + Supabase Swift SDK. Reads/writes mostly go **direct
to Postgres** via the user JWT (RLS-respecting `sb.client.from(...)`), with some
calls to Next API routes using `Authorization: Bearer <session token>` (see
`PromoterRepo` `webBase = https://clubfuoco.com`). `RootView` gates:
`accountKind != "promoter"` → WrongAccount; `!isPromoter` → application-pending;
else `MainTabs`. `MainTabs` = Tonight / Guestlist / Earnings / You. **Supplier
accounts** (own a `partner_brand`, detected via `GET /api/supplier/me`) get
supplier variants of Tonight (venues live tonight) + Guestlist (offer manager)
+ a brand-identity "You"; Earnings is unchanged.

**Faults / gaps:**

1. **No push notifications at all.** The app never registers a device token;
   `notify()` in the backend only fires for consumer/group events. Consequence:
   a promoter has **no way to learn a review outcome** — they submit, see the
   "3 business days" screen (`ReviewSubmittedScreen`), and then silence.
2. **Rejections are invisible and reasonless.** `POST /api/portal/reviews/[id]`
   reject just flips `review_status='rejected'` (nights) / discards (changes).
   No reason captured, nothing shown back to the promoter. Their invite link
   silently stays dead.
3. **No in-app status on their own content.** Promoter nights don't show a
   "Pending review / Rejected" badge in Tonight/Guestlist (only suppliers get a
   pending card, in `SupplierHomeView`). Add a badge keyed on `review_status`.
4. **No edit flow.** `PromoterRepo` has `createSelfGuestlist`/`createSeries` but
   **no update** for an existing night/series — a promoter can only delete +
   recreate. Any edit must also route through review.
5. **Supplier accounts get a hollow Earnings tab.** `EarningsView` is promoter
   payout/billing — irrelevant to a supplier (Rumba). It should be hidden or
   replaced for supplier accounts.
6. **No per-night performance.** Earnings shows payouts, not joined-vs-capacity,
   no-show, or check-in rate.
7. **`valid_days` parsing is heuristic.** The supplier "Tonight" filter parses a
   free-text `valid_days` (`SupplierTonightView.nights(_:)`). The day-picker now
   emits a canonical string, but legacy/free-form data still relies on the
   parser (handles "Every night", comma lists, ranges "Thu – Sun").

**Note:** the supplier feature, approval screens, and day-picker are
**committed** on `main` (`4af0755`), build clean (`xcodebuild ... BUILD
SUCCEEDED`), and are installed on Yakov's iPhone (`00008101-001424640131003A`).
Not yet pushed/released — ships on the next promoter-app build. Project uses
**XcodeGen** (`ios-promoters/project.yml`); run `xcodegen generate` after
adding files.

---

## 3. Partner Portal (staff web) — `src/app/portal/**`

**Architecture.** `/portal` route group in the main app. Auth: `PORTAL_PASSWORD`
env → httpOnly HMAC cookie (`src/lib/portal-auth.ts`); `src/middleware.ts`
guards `/portal/**` + `/api/portal/**` and sets `X-Robots-Tag: noindex`. All
writes use the **service-role** client (`createServiceClient`). UI kit +
"Ember & Onyx" design system in `src/app/portal/_ui.tsx`.

**Tabs:** **Partners** (`/portal` — Suppliers brand cards + Promoters approvals,
merged), **Clubs** (`/portal/clubs` — browse/search/paginate ~1,700 + edit
modal), **Changes** (`/portal/reviews` — the approval queue), **Insights**
(`/portal/insights` — bookings dashboard), **Activity** (`/portal/activity` —
audit log). Key APIs under `/api/portal/**`: `brands`, `brands/[id]` (+`/logo`,
`/activate`, `/offers`, `/provision-login`), `offers/[offerId]`, `clubs`,
`clubs/browse`, `clubs/[id]`, `reviews`, `reviews/[id]`, `promoters`,
`promoters/[id]`, `insights`, `audit`.

**Supplier login provisioning:** `POST /api/portal/brands/[id]/provision-login`
finds/creates a pre-approved promoter account for `login_email`, links
`owner_user_id`, and emails a **Supabase-generated** set-password link **via
Resend** (`sendSupplierPasswordSetup` in `src/lib/email.ts`, from
`partners@clubfuoco.com`). Supabase custom SMTP is pointed at Resend, so auth
emails also flow through Resend. Set-password page: `/supplier/set-password`
(own implicit-flow supabase-js client). Redirect URL must stay in Supabase Auth
→ Redirect URLs (it's under the `https://clubfuoco.com/**` wildcard).

**Faults / gaps:**

1. **You approve nights blind.** The Changes card shows an offer's full
   `payload`, but a **night/series is a one-line summary only** — no time,
   capacity, dress code, or photos. `GET /api/portal/reviews` should join the
   full night/series row so staff can see what they're publishing.
2. **No reject-with-reason.** Portal reject sends no note the promoter sees; add
   a reason box and thread it back (pairs with promoter-app gap #2).
3. **No staff alert when a submission lands.** The "< 3 business days" SLA is
   unmonitored — staff must open the portal to notice the queue. Add an
   email/Slack ping on new `pending_changes` / held night. No SLA clock either.
4. **No promoter drill-down.** The roster (`_promoters.tsx`) is flat (name +
   Revoke). No profile: their nights, performance, payout history, contact.
5. **Insights has no drill-down.** Aggregates only (`/api/portal/insights`) — no
   opening a night's guest list or a venue's bookings.
6. **Single shared password.** No per-staff identity → the audit log's "who" is
   always "operator"; no 2FA on the portal. (Deliberate per the no-accounts
   policy, but a ceiling.)
7. **Queues don't scale yet.** Changes/roster have no search, pagination, or
   bulk approve.
8. **Per-supplier club scoping deferred.** A supplier can add an offer at ANY
   active club — there's no "clubs this supplier is contracted for" restriction
   (conflicts with the "full self-service" choice; needs a product decision).
9. **Cover-image upload parity.** Club editor takes a cover URL (text), while
   the brand logo is a real upload — inconsistent. SVG logos don't render in the
   app's `AsyncImage`.

---

## 4. Fuoco consumer app — `ios-native/` + web `src/app/(app)`

_(Lighter coverage — this surface was not deep-audited this session; below is
what's confirmed relevant to the partner/approval work.)_

**Architecture.** SwiftUI native app + Next web. Web is **invite-only** (see the
`WEB_ALLOWED` list in `src/middleware.ts` — everything else bounces to `/`).
Front-page guestlist offers come from **`GET /api/partner`** (active brand +
offers by club), consumed by `src/contexts/PartnerContext.tsx` (web) and
`RumbalistOffers.refresh` (iOS, at launch + on scenePhase `.active`). Booking
sheets: web `src/components/RumbalistBookSheet.tsx`, iOS
`RumbalistOfferSheet.swift` — VIP Apple Pay is **iOS-only**; web points users to
the app. Attribution credit ("Guestlist by …") renders only when
`attribution_required`.

**Guest-join / invite flow** (shared with promoters): `/i/[token]` page +
`/api/promoter-invites/**` resolve a promoter's invite token → allocation →
night. **Now gated on `review_status`** (defensively) so held nights aren't
joinable. Public discovery feed `/api/nero/events` filters `is_published=true`.

**Faults / gaps (known / to verify):**
1. **Stale brand palette risk.** Rumba's brand `color` in the DB is still the
   legacy pink `#FF2D92`; the app accent must stay ember `#C09950` — pink is a
   Rumbalist remnant, never the Club Fuoco accent. Audit any place the brand
   color leaks beyond the small supplier credit.
2. **Attribution re-add scope.** When the app went first-party, supplier marks
   were removed; the credit was re-added as a subordinate line only. Verify no
   other consumer surface needs the credit (booking sheet is done).
3. **Consumer app not audited for its own gaps** this session (discovery,
   search, membership/IAP, notifications) — a dedicated pass is warranted.
4. **iOS consumer (`ios-native`) changes are committed** (`18d7da2`:
   attribution credit, palette, share-message emoji removal) but not yet
   released — ships next App Store build.

---

## 5. Cross-cutting

- **Email:** Resend (`src/lib/email.ts`, `RESEND_API_KEY`, from
  `tickets@clubfuoco.com` for tickets, `partners@clubfuoco.com` for partner
  access). Domain `clubfuoco.com` is verified; any mailbox on it sends with no
  setup. Supabase auth emails route through Resend via custom SMTP
  (`smtp.resend.com:465`, user `resend`).
- **Emojis** were stripped from all user-facing strings (portal, emails, push
  titles, iOS share text). Country-picker flags kept (functional); typographic
  glyphs kept.
- **iOS builds/installs:** device build via
  `xcodebuild -project … -destination 'id=00008101-001424640131003A' -allowProvisioningUpdates`
  then `xcrun devicectl device install app --device … "<.app>"`. Signing team
  `4V87UVPTBW`. Device must be unlocked to launch.
- **The `pending_changes` graceful fallback** means the portal/apps keep working
  before a migration lands — reads no-op, writes fall back to live. Keep new
  gates defensive the same way (a missing column must never break guest joins).

---

## 6. Cleanup / loose ends

- **Throwaway test data in prod:** brand **"ZZ Email Test"** (`zz-emailtest-9663`)
  linked to `yakov.a.v@icloud.com`; and **Rumba's `login_email` = `test12345@clubfuoco.com`**
  (should be Rumba's real operator address). Delete the test brand + its
  account; set Rumba's real login.
- **iOS committed, not released:** `ios-promoters` (supplier + approval,
  `4af0755`) and `ios-native` (attribution/palette/emoji, `18d7da2`) are on
  `main` and build clean, but not pushed or shipped. Release on the normal
  cadence.
- **Two apps' review-submitted screen** is shared (`ReviewSubmittedScreen`).

---

## 7. Recommended next steps (priority order)

1. **Close the review loop** (highest leverage):
   a. Notify the promoter on approve/reject **with a rejection reason** (Resend
      now, push later) + a reject-reason box in the portal.
   b. Alert staff when a submission lands (email/Slack) to actually meet the
      "3 business days" SLA.
   c. Show full night/series detail in the Changes card (approve informed).
   d. Surface pending/rejected status on the promoter's own nights in-app.
2. **Promoter push notifications** (token registration in FuocoPromoters) — the
   foundation for (1a/1d) and guest-join alerts.
3. **Night/offer edit flow** (through review).
4. **Supplier-account UX cleanup** (hide/replace Earnings; per-night stats).
5. **Portal depth:** promoter drill-down profile, Insights drill-down, queue
   search/pagination/bulk.
6. **Product decisions to make:** per-supplier club scoping; per-staff portal
   identities + 2FA; whether "supplier" and "promoter" should unify in the data
   model (currently only merged in the UI).
