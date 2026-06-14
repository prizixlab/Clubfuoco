# Club Fuoco — Native iOS (SwiftUI)

**This is the shipping iOS app** (it replaced the Capacitor WebView build at
v1.1.0 / build 17). Talks to the same backend: Supabase (auth + PostgREST
under RLS) and the Vercel REST API (`https://clubfuoco.vercel.app/api/*`)
with `Authorization: Bearer` auth. See `AGENTS.md` at the repo root for the
backend contract.

## Requirements

- Xcode 16+ (built against iOS 17 deployment target)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

## Build & run

```sh
cd ios-native
xcodegen generate        # creates ClubFuoco.xcodeproj from project.yml
open ClubFuoco.xcodeproj # build/run the ClubFuoco scheme on a simulator
```

The `.xcodeproj` is generated and git-ignored — `project.yml` is the source of
truth. After adding/removing files, re-run `xcodegen generate`.

## Layout

```
ClubFuoco/
├── App/            @main, RootView (splash → login → tabs), composition root
├── Core/
│   ├── Networking/ APIClient — typed REST client, Bearer injection, {data,error} envelope
│   ├── Supabase/   SupabaseService (auth) + Queries (PostgREST mirrors of src/lib/supabase/queries.ts)
│   ├── DesignSystem/ Theme tokens, haptics
│   └── Localization/ Localizable.xcstrings (en + es)
├── Models/         Codable models matching the API/PostgREST shapes
├── Stores/         @Observable: AuthStore, LocaleStore, PlanStore
└── Features/       Per-screen View + ViewModel pairs
```

## Debug hooks (Simulator automation, DEBUG builds only)

- `SIMCTL_CHILD_CF_TEST_EMAIL` / `SIMCTL_CHILD_CF_TEST_PASSWORD` — auto sign-in on launch
- `SIMCTL_CHILD_CF_TEST_GUEST=1` — continue as guest on launch
- `SIMCTL_CHILD_CF_TEST_TAB` — initial tab (`explore` | `tickets` | `you`)
- `SIMCTL_CHILD_CF_TEST_AUTH_ROUTE` — open auth screen (`login` | `signup`)
- `SIMCTL_CHILD_CF_TEST_OPEN_FIRST_CLUB=1` — open the first venue's detail
- `SIMCTL_CHILD_CF_TEST_OPEN_RUMBA=1` — open the first rumba's detail
- `SIMCTL_CHILD_CF_TEST_BOOK=1` — present the booking sheet (with `CF_TEST_OPEN_FIRST_CLUB=1`)
- `SIMCTL_CHILD_CF_TEST_OPEN_FIRST_GROUP=1` — open the first group's detail (Tickets tab)
- `SIMCTL_CHILD_CF_TEST_PUSH=settings|friends|membership|notifications|fiamme` — push a screen (with `CF_TEST_TAB=you`)
- `SIMCTL_CHILD_CF_TEST_FRIENDS_QUERY=<q>` — prefill the friends search
- `SIMCTL_CHILD_CF_TEST_SETTINGS=1` — alias for `CF_TEST_PUSH=settings`

StoreKit: `ClubFuoco/ClubFuoco.storekit` is wired into the scheme for local
subscription testing in Xcode runs (server-side verification rejects local
test signatures by design — use a sandbox Apple ID for the full loop).

## Release

Versioning continues from the last Capacitor release (1.0.2 / 16) — bump
`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `project.yml`, regenerate,
then archive:

1. `xcodegen generate`
2. Open `ClubFuoco.xcodeproj`, select **Any iOS Device**, Product → Archive
3. Distribute via App Store Connect (same app record — bundle ID
   `com.clubfuoco.app` is unchanged, so this ships as a normal update)

Before the first store submission, verify on a physical device: Sign in with
Apple, Google sign-in, one real Apple Pay booking, one sandbox IAP purchase,
and an Add-to-Wallet pass (none of these are fully testable in the Simulator).

Localization is generated: `node scripts/gen-xcstrings.js` rebuilds
`Localizable.xcstrings` from `src/messages/{en,es}.ts` + the native-only keys
in the script. Re-run it after editing the web dictionaries.
