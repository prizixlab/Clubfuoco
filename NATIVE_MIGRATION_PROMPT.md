# Fable 5 Prompt — Migrate Club Fuoco to Native SwiftUI

> Paste the block below into a Fable 5 session opened at the repo root.
> This is a **multi-session, phased** migration, not a one-shot. The prompt tells Fable 5 to
> work phase-by-phase and check in. Don't expect (or accept) the whole app rewritten in one turn.

---

## ROLE & GOAL

You are a senior iOS engineer. Migrate the **Club Fuoco** app from its current **Capacitor + Next.js
(TypeScript) WebView** implementation to a **fully native iOS app in Swift / SwiftUI**, so it feels
faster and more native to users and gives us cleaner long-term control of the iOS experience.

**Keep the existing backend unchanged.** This is a *frontend* rewrite only.

## CURRENT STATE (what exists today)

- **Repo:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, shipped to:
  - **Web** → Vercel (`https://clubfuoco.vercel.app`) — this stays as-is, keep shipping it.
  - **iOS** → Capacitor static export wrapping the web bundle — **this is what we are replacing.**
- **Backend (KEEP):**
  - **Supabase** — auth (incl. Sign in with Apple / OAuth), Postgres, storage. Schema lives in
    `supabase/migrations/*.sql`. Data access is via the Supabase client (no ORM).
  - **~100 REST API routes** in `src/app/api/**` running on Vercel. The native app should call these
    over HTTPS exactly as the Capacitor app does today.
- **How the current iOS app talks to the backend (replicate this contract):** see `src/lib/api.ts`.
  Under Capacitor it (a) prefixes `/api/*` calls with `https://clubfuoco.vercel.app`, and
  (b) attaches the Supabase session as `Authorization: Bearer <access_token>` because native
  requests don't carry cookies. **Your native networking layer must do the same: Bearer-token auth
  against the Vercel API base.**

## TARGET ARCHITECTURE

- **SwiftUI** (iOS 17+), MVVM, Swift Concurrency (`async/await`), Observation framework.
- **Networking layer:** a typed API client hitting `https://clubfuoco.vercel.app/api/*`, injecting the
  Supabase `Bearer` token on every request, with `Codable` models. Centralize base URL + auth.
- **Auth:** use the official **`supabase-swift`** SDK for session management (email/OAuth/Sign in with
  Apple), then forward its access token to the API client. Persist session in Keychain.
- **State:** `@Observable` view models per feature; a shared `Session`/`AuthStore`, `LocaleStore`,
  and `MembershipStore` mirroring today's React contexts (`AuthContext`, `LocaleContext`,
  `PlanContext`).
- **Navigation:** `NavigationStack` + a native `TabView` replacing `BottomNav`/`TopNav`.
- **No WebViews** for core app surfaces. (A WebView is acceptable only for legal/marketing pages if we
  choose to defer those — flag it, don't assume.)

## FEATURE SURFACE TO PORT (from `src/app/(app)/**`, `(auth)`, `(staff)`)

Port these screens to native. Mirror the existing API endpoints under `src/app/api/**` for each.

- **Auth:** login, signup, complete-profile, Sign in with Apple / OAuth (`OAuthButtons`), splash.
- **Core app (tabbed):** explore feed, club/venue detail, bookings, profile, settings (incl. language
  picker), notifications, saved, onboarding.
- **Social & groups:** friends (search/respond), groups (invite/join/allocate/remind), rumbas, fiamme
  (points/redeem), guest lists.
- **Membership & payments:** membership/plans, subscribe/cancel, **Apple IAP verification**
  (`/api/memberships/iap/verify`), Stripe (web/Apple Pay) where applicable.
- **Tickets & Wallet:** ticket purchase/confirm, **Apple Wallet passes** (PassKit) — see
  `src/app/api/wallet/**` and `src/lib/wallet/**`. Use native PassKit / `PKAddPassesViewController`.
- **Operator surfaces:** club-dashboard, club-verify, dj / dj-dashboard, guestlist, admin, staff
  check-in (`(staff)/staff`). These can be a **later phase** — confirm priority before building.
- **Marketing/legal** (`src/app/_web/**`, `legal/*`): NOT part of the native app — stays web-only.

## TRICKY AREAS — handle explicitly

1. **Auth token bridge:** `supabase-swift` session → `Bearer` header on every API call. Refresh on
   expiry. Match the behavior in `src/lib/api.ts`.
2. **Apple IAP:** use StoreKit 2 natively; verify receipts against `/api/memberships/iap/verify` and
   the Apple webhook flow (`src/lib/apple-iap.ts`, `src/app/api/webhooks/apple`).
3. **Apple Wallet:** generate/add passes natively via PassKit instead of the current
   `passkit-generator` + web-service registration flow. The pass web-service endpoints in
   `src/app/api/wallet/v1/**` can stay server-side for updates/push.
4. **Deep links / OAuth callbacks:** replace `AuthDeepLinkHandler.tsx` + Capacitor URL handling with
   native Universal Links / `ASWebAuthenticationSession`.
5. **i18n:** today strings live in `src/messages/{en,es}.ts` (English + Castellano). Port these into a
   native `Localizable.strings` (or String Catalog) for `en` + `es`, preserving the device/manual
   locale toggle (current localStorage key `cf-locale`). **Every user-facing string must exist in both
   languages — do not hardcode copy.**
6. **Presence/signals/analytics:** `PresenceTracker`, `/api/signals/**`, `/api/ticket-clicks` — wire
   equivalents natively.
7. **Native feel (the whole point):** native scroll/lists, momentum, safe areas, haptics on key
   actions, native sheets for things like `RumbalistBookSheet`/`SurveySheet`, native back-swipe
   (replaces the hand-rolled `SwipeBack`).

## CONSTRAINTS & RULES

- **Do not modify** `src/app/api/**`, `src/lib/**` server logic, or `supabase/**`. If you find the API
  contract is unclear, read the relevant `route.ts` and the matching Supabase migration to infer the
  request/response shape — then document it, don't change it.
- Keep the existing **web app and Vercel deploy fully working.** Don't touch `next.config.ts` build
  paths, the Capacitor config can be removed only in the final phase once native replaces it.
- Build the native app in a **new top-level directory** (e.g. `ios-native/` or a fresh Xcode project),
  not by mutating the existing `ios/` Capacitor project, until parity is reached.
- Use Swift's standard tooling; target iOS 17+. No third-party UI frameworks unless justified.

## DELIVERABLES & WORKING STYLE

Work in **phases**, and at the end of each phase report what's done, what's verifiable in the
Simulator, and what's next. **Stop and ask** before starting a new phase or making an irreversible
decision (e.g. deleting the Capacitor project).

1. **Phase 0 — Foundation:** Xcode project, app target, `supabase-swift` auth, the typed API client
   with Bearer auth, `Codable` models for the core endpoints, design tokens/theme, localization
   scaffold (en/es), tab + nav skeleton. Prove one real authenticated API call end-to-end.
2. **Phase 1 — Core loop:** auth screens → explore feed → venue detail → bookings → profile/settings.
   This is the demoable "it feels native" milestone.
3. **Phase 2 — Social/commerce:** groups, friends, rumbas, fiamme, guest lists, membership + IAP,
   tickets + Wallet.
4. **Phase 3 — Operator/staff surfaces** (confirm scope first).
5. **Phase 4 — Cutover:** replace the Capacitor iOS build, update CI/release, retire Capacitor deps.

For each screen: build the SwiftUI view + `@Observable` view model + API calls, then verify it builds
and runs in the iOS Simulator before moving on. Match the existing UX/visual design unless an
obviously more-native pattern is warranted (call those out).

## START HERE

Begin with **Phase 0 only.** First, read `src/lib/api.ts`, `src/contexts/AuthContext.tsx`,
`src/lib/supabase/*`, and 2–3 representative endpoints (`src/app/api/clubs/route.ts`,
`src/app/api/bookings/route.ts`, `src/app/api/auth/me/route.ts`) to lock down the auth + data
contract. Then propose the Xcode project structure and the API-client design **for my approval before
writing the bulk of the code.**
