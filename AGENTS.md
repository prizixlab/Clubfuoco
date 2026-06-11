# Club Fuoco — Codebase Guide

Nightlife app for Barcelona. **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind**, backed by **Supabase** (auth, Postgres, storage). Ships two ways from one codebase:

- **Web** → deployed to **Vercel** (`https://clubfuoco.vercel.app`). API routes run server-side here.
- **iOS** → **Capacitor** static export (`output: 'export'`). The native shell loads a static bundle from disk; it has **no API routes** and calls the Vercel backend over HTTP.

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
| **Native config** | `capacitor.config.ts`, `ios/` |
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
- `api.ts` — **`apiFetch()` frontend helper.** Critical: under Capacitor (`capacitor:` protocol) it rewrites `/api/*` to the Vercel host and attaches the Supabase session as a `Bearer` token (native requests don't send cookies). On web it uses relative paths. Use this for all client→API calls.
- `auth.ts`, `membership.ts`, `plan.ts`, `preferences.ts` — domain logic.
- `stripe.ts`, `iap.ts`, `apple-iap.ts` — payments (Stripe web + Apple in-app purchase).
- `email.ts` (Resend), `notify.ts` — messaging.
- `qr.ts`, `tickets.ts`, `wallet/{apn,push,token}.ts` — tickets & Apple Wallet passes (`passkit-generator`, APNs push).
- `hours.ts`, `venue-classify.ts`, `photo-filter.ts`, `rumba-score.ts`, `rumbalist-*.ts`, `groups.ts`, `verificationPhrase.ts`, `utils.ts` — misc helpers.

### Database — `supabase/`
`migrations/*.sql` (raw SQL, applied in Supabase) and `seed.sql`. No ORM — data access is through the Supabase JS client.

## Web vs. iOS — read before changing build/data flow

- `next.config.ts` switches on `BUILD_TARGET=ios`: enables `output: 'export'` + unoptimized images, and aliases the native-only Stripe plugin to `false` for web.
- `scripts/build-ios.sh` (`npm run build:ios`) temporarily moves `src/app/api` aside (to `.api_backup`), builds the static export, then restores it. Dynamic route pages keep a placeholder `generateStaticParams()` wrapper so Next.js can prerender; Capacitor then navigates client-side.
- Native-only Capacitor plugins (e.g. `@capacitor-community/stripe`) must stay guarded by `Capacitor.isNativePlatform()`.
- **Rule of thumb:** anything the iOS app needs at runtime must come from Supabase or a Vercel API route via `apiFetch()` — not from a local API route, which doesn't exist on device.

## Commands

```bash
npm run dev          # local Next.js dev server (web)
npm run build        # web production build
npm run lint         # eslint (eslint-config-next)
npm run build:ios    # static export for Capacitor
npm run open:ios     # open the iOS project in Xcode
npm run cap:dev      # cap sync ios (dev)
# data scripts (need .env.local):
npm run osm:fill     # OpenStreetMap venue fill
npm run nb:fill / nb:apply   # neighborhood enrichment
```

Env: copy `.env.example` → `.env.local`. Stack: Next 15, React 19, TS 5.7, Tailwind 3.4, Supabase JS, Stripe, Resend, Zod, Capacitor 8.

## Conventions

- TypeScript everywhere; path alias `@/` → `src/`.
- Validate inputs with `zod`.
- i18n: every user-facing string goes through `t()` with keys in both `en.ts` and `es.ts`.
- Keep web-only/native-only code paths cleanly guarded so neither build breaks the other.
