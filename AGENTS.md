# Club Fuoco — Codebase Guide

Nightlife app for Barcelona. **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind**, backed by **Supabase** (auth, Postgres, storage). Ships two ways from one codebase:

- **Web** → deployed to **Vercel** (`https://clubfuoco.vercel.app`). API routes run server-side here.
- **iOS** → **fully native SwiftUI app** in `ios-native/` (Xcode project generated with XcodeGen). It talks to the same backend: Supabase via `supabase-swift` (auth + PostgREST under RLS) and the Vercel API routes over HTTPS with `Authorization: Bearer <supabase access token>`. See `ios-native/README.md`.

This dual-target split is the single most important thing to understand before changing anything. See "Web vs. iOS" below.

## Quick map

| Area | Path |
|------|------|
| **Frontend pages** | `src/app/**` (App Router route groups) |
| **Frontend components** | `src/components/**` |
| **Backend (API routes)** | `src/app/api/**` |
| **Data/server logic** | `src/lib/**` |
| **Supabase clients** | `src/lib/supabase/**` |
| **DB schema & migrations** | `supabase/migrations/**`, `supabase/seed.sql` |
| **React contexts** | `src/contexts/**` |
| **i18n dictionaries** | `src/messages/{en,es}.ts` |
| **Types** | `src/types/index.ts` |
| **Build/data scripts** | `scripts/**` |
| **Native iOS app** | `ios-native/` (SwiftUI, XcodeGen) |
| **App config** | `next.config.ts`, `tailwind.config.ts`, `tsconfig.json` |

## Frontend

All UI lives under `src/app/` using App Router **route groups** (parenthesized folders don't appear in the URL):

- `src/app/(app)/**` — the authenticated app: `explore`, `clubs`, `bookings`, `profile`, `settings`, `notifications`, `groups`, `friends`, `membership`, `rumbas`, `fiamme`, `guestlist`, `saved`, `onboarding`, plus operator surfaces (`admin`, `club-dashboard`, `club-verify`, `dj`, `dj-dashboard`).
- `src/app/(auth)/**` — `login`, `signup`, `complete-profile`.
- `src/app/(staff)/staff/**` — staff check-in tools.
- `src/app/_web/**` — public **marketing site** (Home, SiteNav, partner subpages) + its CSS. Routes: `about`, `press`, `investors`, `partners/*`, `legal/*`.
- `src/app/_native/**` — native-only screens (`Splash.tsx`).
- `src/app/{layout,page,manifest}.tsx` — root layout, landing entry, PWA manifest.

Shared components:
- `src/components/ui/` — `BottomNav`, `TopNav`, `DrumPicker`, `PaymentForm`.
- `src/components/` — feature components (`RumbalistBookSheet`, `SurveySheet`, `MemberDashboard`, `WhenPlanner`, `OAuthButtons`, `PresenceTracker`, `SwipeBack`, etc.).

Cross-cutting state via React context in `src/contexts/`:
- `AuthContext.tsx` — session/user (paired with `src/hooks/useAuth.ts`).
- `LocaleContext.tsx` — i18n: `useLocale()` + `t(key)`. Strings live in `src/messages/en.ts` (source of truth + `MessageKey` type) and `es.ts` (Castellano). **Add new UI strings to both files; never hardcode copy.** localStorage key `cf-locale` (`'en'|'es'|'device'`).
- `PlanContext.tsx` — membership/plan state.

## Backend

### API routes — `src/app/api/**`
Standard App Router route handlers (`route.ts`). These run **only on the web/Vercel build** (the iOS static export strips them out at build time). Grouped by domain: `auth`, `bookings`, `clubs`, `dj`, `groups`, `guest-lists`, `memberships`, `rumbas`, `fiamme`, `friends`, `notifications`, `places`, `tickets`, `wallet` (Apple Wallet pass web service), `webhooks` (`stripe`, `apple`), and `admin/**` (internal tooling).

### Server/data logic — `src/lib/**`
- `supabase/client.ts` — browser client. `supabase/server.ts` — server (cookie/SSR) client. `supabase/queries.ts` — shared query helpers.
- `api.ts` — **`apiFetch()` frontend helper.** On web it uses relative paths. (The native iOS app implements the same contract in Swift: Vercel host prefix + `Authorization: Bearer <supabase access token>`, since native requests don't send cookies — see `ios-native/ClubFuoco/Core/Networking/APIClient.swift`.)
- `auth.ts`, `membership.ts`, `plan.ts`, `preferences.ts` — domain logic.
- `stripe.ts`, `iap.ts`, `apple-iap.ts` — payments (Stripe web + Apple in-app purchase).
- `email.ts` (Resend), `notify.ts` — messaging.
- `qr.ts`, `tickets.ts`, `wallet/{apn,push,token}.ts` — tickets & Apple Wallet passes (`passkit-generator`, APNs push).
- `hours.ts`, `venue-classify.ts`, `photo-filter.ts`, `rumba-score.ts`, `rumbalist-*.ts`, `groups.ts`, `verificationPhrase.ts`, `utils.ts` — misc helpers.

### Database — `supabase/`
`migrations/*.sql` (raw SQL, applied in Supabase) and `seed.sql`. No ORM — data access is through the Supabase JS client.

## Web vs. iOS — read before changing build/data flow

- The iOS app is **fully native** (`ios-native/`, SwiftUI + supabase-swift). There is no WebView and no static export; the Capacitor shell was retired after the native cutover.
- The native app consumes the backend two ways, mirroring the web client: direct Supabase PostgREST queries under RLS (mirrors `src/lib/supabase/queries.ts`) and the Vercel API routes with Bearer-token auth (mirrors `src/lib/api.ts`). **Changing an API route's request/response shape or a table's RLS policy affects the shipped iOS app** — keep contracts stable or version them.
- User-facing copy lives in `src/messages/{en,es}.ts`; the native app generates its String Catalog from these via `ios-native/scripts/gen-xcstrings.js` — re-run it after editing the dictionaries.
- **Rule of thumb:** anything the iOS app needs at runtime must come from Supabase or a Vercel API route — never from web-only state (cookies, localStorage).

## Commands

```bash
npm run dev          # local Next.js dev server (web)
npm run build        # web production build
npm run lint         # eslint (eslint-config-next)
# iOS (native app):
#   cd ios-native && xcodegen generate && open ClubFuoco.xcodeproj
# data scripts (need .env.local):
npm run osm:fill     # OpenStreetMap venue fill
npm run nb:fill / nb:apply   # neighborhood enrichment
```

Env: copy `.env.example` → `.env.local`. Stack: Next 15, React 19, TS 5.7, Tailwind 3.4, Supabase JS, Stripe, Resend, Zod. iOS: SwiftUI (iOS 17+), supabase-swift, GoogleSignIn, StripeApplePay.

## Conventions

- TypeScript everywhere; path alias `@/` → `src/`.
- Validate inputs with `zod`.
- i18n: every user-facing string goes through `t()` with keys in both `en.ts` and `es.ts`.
- Keep web-only/native-only code paths cleanly guarded so neither build breaks the other.
