# Brief & Plan: Dark Mode for the Club Fuoco consumer iOS app

**Self-contained** — no prior conversation needed. Hand this to a fresh Claude Code session.

---

## 0. TL;DR

The consumer iOS app is hardcoded light and locked with `.preferredColorScheme(.light)`.
Add a proper **Dark Mode** with a user-facing **Light / Dark / System** control in Settings.
The leverage point: ~848 color usages route through ~13 `Theme.*` tokens — make those
adaptive and most of the app flips at once. The slog: ~277 inline hardcoded colors
(`Color.white`, `Color(hex:)`, `.black.opacity`) across 45 files that each need a
per-case decision. Do it **phased**, and **QA on-device with screenshots** (invisible
white-on-white elements are the main risk).

---

## 1. Where things are

| | |
|---|---|
| Repo | `/Users/yakovvinnik/Clubfuoco` (git remote `origin`, branch `main`, auto-deploys web via Vercel on push — irrelevant here, this is iOS-only) |
| Target | `ios-native/ClubFuoco` — Xcode project `ios-native/ClubFuoco.xcodeproj`, scheme `ClubFuoco` |
| Design tokens | `ios-native/ClubFuoco/Core/DesignSystem/Theme.swift` (`enum Theme`) |
| Light lock | `ios-native/ClubFuoco/App/ClubFuocoApp.swift:18` — `.preferredColorScheme(.light)` |
| Settings (add the control here) | `ios-native/ClubFuoco/Features/Settings/SettingsView.swift` — copy the existing **Language** picker section |
| Locale store (copy this pattern) | `ios-native/ClubFuoco/Stores/LocaleStore.swift` — `@Observable`, persisted under a UserDefaults key, injected via `.environment(...)` in `ClubFuocoApp` |

> **NOTE:** `ios-native/ClubFuoco.xcodeproj/project.pbxproj` is **gitignored**. New Swift
> files must be added to the Xcode target locally (find the 4 entries for an existing
> file in the pbxproj and mirror them: PBXBuildFile, PBXFileReference, group children,
> Sources build phase). Prefer editing existing files over adding new ones to avoid this.

### Build & install to the physical iPhone (device UDID is stable)
```bash
cd /Users/yakovvinnik/Clubfuoco/ios-native
xcodebuild -project ClubFuoco.xcodeproj -scheme ClubFuoco -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath build/DD -allowProvisioningUpdates build
xcrun devicectl device install app --device 93AC401C-4E30-5977-ACD0-8F5C99F52E92 \
  "build/DD/Build/Products/Debug-iphoneos/Club Fuoco.app"
```
(iPhone must be unlocked for install to mount the developer image.)

---

## 2. Current palette (`Theme.swift`) — the tokens to make adaptive

All are fixed light-mode hex today:

| Token | Light hex | Role |
|---|---|---|
| `ink` | `#221E1A` | primary text / dark surfaces |
| `stone` | `#6E6356` | secondary text |
| `sand` | `#B0A898` | inactive / tertiary |
| `fadedSand` | `#9F9486` | captions, overlines |
| `cream` | `#F8F5EE` | **app background** |
| `gold` | `#C09950` | accent (active pill, highlights) |
| `wine` | `#8C2A2A` | badges / destructive |
| `hairline` | `ink @ 10%` | dividers |
| `night` | `#0A0807` | already-dark surfaces (splash/hero) |
| `parchment` | `#F4ECDD` | light text on dark |
| `ember` | `#C2562D` | dark-surface CTA |
| `emberCream`/`flame`/`darkRed` | — | dark-surface accents |

The `night / parchment / ember / flame / darkRed` group is **already the dark palette**
used by splash, the DJ sheet, the offer sheet, share cards, InviteClaimView. **Leave
those surfaces as-is** — they are intentionally dark in both modes.

---

## 3. Design decisions (locked)

1. **Adaptive tokens, not a second theme object.** Make each `Theme.*` color resolve per
   trait collection so the 848 call sites need no change. Recommended implementation:
   ```swift
   extension Color {
       /// Light/dark adaptive color from two hex values.
       static func adaptive(light: UInt32, dark: UInt32) -> Color {
           Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
               ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
       }
   }
   ```
   Then e.g. `static let cream = Color.adaptive(light: 0xF8F5EE, dark: 0x0E0C0A)`.
2. **User control in Settings: Light / Dark / System**, persisted, applied at the app root
   via `.preferredColorScheme(...)`. Copy `LocaleStore` → new `ThemeStore` (`@Observable`,
   key `cf-theme`, enum `system/light/dark`). Inject in `ClubFuocoApp`, replace the
   hardcoded `.preferredColorScheme(.light)` with `theme.colorScheme` (nil = system).
   Add a picker section in `SettingsView` right after the Language one (add
   `settings.theme` / `settings.theme.system|light|dark` strings to
   `Core/Localization/Localizable.xcstrings` in **en/es/ca/fr** — see the existing
   `settings.lang.*` keys as the template; 4 languages, keep placeholders intact).
3. **Brand rules (do not violate):** app accent is **gold `#C09950`**, NEVER pink.
   `#FF2D92` is a stale Rumbalist remnant. Supplier branding (Rumba pink / Aashi) is
   **confined to the booking flow** (offer sheet + reservation page) and must stay
   driven by the supplier's own `brand.color` — don't fold it into the app dark theme.
4. **Keep the already-dark surfaces dark** in both modes (see §2). Don't invert them.

---

## 4. Proposed dark values (starting point — refine during QA)

| Token | Light | Dark (proposed) | Notes |
|---|---|---|---|
| `cream` (bg) | `#F8F5EE` | `#0E0C0A` | warm near-black, distinct from pure `night` |
| `ink` (text/surfaces) | `#221E1A` | `#EDE6D8` | ⚠️ `ink` is used BOTH as text AND as dark surfaces — see §6 gotcha |
| `stone` (2nd text) | `#6E6356` | `#B4AA9A` | |
| `sand` | `#B0A898` | `#7A7264` | |
| `fadedSand` (caption) | `#9F9486` | `#8A8striped→ 0x8A8172` | |
| `gold` | `#C09950` | `#C09950` | unchanged; reads on both |
| `wine` | `#8C2A2A` | `#C85450` | lighten for contrast on dark |
| `hairline` | `ink @10%` | `parchment @12%` | make hairline its own adaptive token |
| card surface (`Color.white`) | `#FFFFFF` | `#1A1613` | introduce a `Theme.surface` token for this |

Add **two new semantic tokens** to reduce guesswork during the sweep:
`Theme.surface` (was `Color.white` cards) and `Theme.surfaceRaised` (elevated/QR cards).

---

## 5. The inline-hardcode inventory (the sweep)

Run to enumerate:
```bash
cd ios-native/ClubFuoco
git ls-files '*.swift' | xargs grep -n "Color\.white\|\.white)\|Color(hex: 0x\|\.black\.opacity"
```
Approx counts: **`Color.white`/`.white` ×117, `Color(hex:0x…)` ×129, `.black.opacity` ×31**,
across **45 files**. Classify each:
- **Card/background `Color.white`** → `Theme.surface` (adaptive).
- **`Color(hex: 0x…)` literals** → map to the nearest token or make a new adaptive token.
- **`.black.opacity(…)` scrims over photos** → usually keep (photos are dark-on both), but
  check any used as a *surface* rather than a photo scrim.
- **Hero gradients / status overlays over images** → generally fine in both modes.

---

## 6. Gotchas (read before starting)

1. **Why the light lock exists:** bare `TextField`s render text as `Color.primary` (white)
   on the cream background in dark → invisible. Before removing the lock, audit every
   `TextField`/`SecureField` and set an explicit `.foregroundStyle(Theme.ink)` (now
   adaptive) or `.tint`. Grep: `git ls-files '*.swift' | xargs grep -ln "TextField\|SecureField"`.
2. **`Theme.ink` is overloaded** — it's the primary *text* color AND used as a *dark surface*
   fill in a few places. When you make `ink` adaptive (dark→light text), any spot using
   `ink` as a *surface* will invert wrongly. Grep `Theme.ink` and split those surface uses
   onto `Theme.surface`/a fixed color first.
3. **Invisible elements are the #1 risk** — a missed `Color.white` becomes white-on-dark or
   white-on-white. QA is screen-by-screen, not a spot check.
4. **`InviteClaimView` already forces `.preferredColorScheme(.dark)`** (2 spots) — leave it.
5. **Shadows**: `.shadow(color: Color(hex:0x221E1A)...)` (ink-ish) are near-invisible on dark
   and fine to leave, but heavy ones may need reducing.

---

## 7. Phased plan

### Phase 0 — Scaffolding (no visual change yet)
- Add `Color.adaptive(light:dark:)` helper + a `Theme.hairline`/`Theme.surface`/
  `Theme.surfaceRaised` set.
- Create `ThemeStore` (copy `LocaleStore`): enum `system/light/dark`, key `cf-theme`,
  `var colorScheme: ColorScheme?`. Inject in `ClubFuocoApp`; replace the hardcoded
  `.preferredColorScheme(.light)` with `theme.colorScheme`. **Default = `.light`** so
  nothing changes until the user opts in.
- Add the Settings picker + localized strings.
- **Acceptance:** app still looks identical in Light; switching to Dark in Settings shows a
  half-broken dark screen (expected). Commit.

### Phase 1 — Make `Theme` tokens adaptive
- Give every `Theme` color a dark value (§4). Split overloaded `ink` surface-uses first (§6.2).
- **Acceptance:** core chrome (backgrounds, text, dividers) is legible in Dark on Explore,
  Club detail, Tickets. Screenshot all three. Commit.

### Phase 2 — Sweep inline hardcodes on high-traffic screens
- Explore (`Features/Explore/*`, esp. `ExploreCards.swift`), Club detail
  (`Features/ClubDetail/ClubDetailView.swift`), Tickets/Bookings (`Features/Bookings/*`),
  Settings, Auth/Login, Profile.
- Convert `Color.white` cards → `Theme.surface`, hex literals → tokens.
- **Acceptance:** those flows have zero invisible elements in Dark. Device screenshots each. Commit per area.

### Phase 3 — Remaining screens + TextField audit
- Everything else (Groups, Fiamme, Friends, Rumbalist, onboarding). Fix all TextFields (§6.1).
- **Acceptance:** full walkthrough in Dark, no invisibles. Commit.

### Phase 4 — Polish & optional
- Tune dark values for depth/contrast; check Dynamic Type + the theme-aware supplier
  branding still reads. Optionally flip the **default** to `.system`.
- **Acceptance:** sign-off screenshots of every screen in both modes.

---

## 8. Verification (do this, don't ask the user to)

The iOS Simulator/device tooling can screenshot the physical device. After each phase:
build + install (commands in §1), open the relevant screen, screenshot, inspect for
invisible/low-contrast elements, fix, repeat. Send the user before/after screenshots per
phase for sign-off. Also toggle `resize_window`/OS appearance to compare Light vs Dark.

## 9. Commit / push conventions
Small, per-area commits. Co-author trailer:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Push to `main` only when asked.
Build after every change; **never** leave a build broken between commits.

## 10. Definition of done
- Light / Dark / System control in Settings, persisted, localized (en/es/ca/fr).
- Every consumer screen legible in Dark — no invisible/low-contrast elements.
- App accent stays gold; supplier branding still its own colors in the booking flow.
- Already-dark surfaces unchanged. Screenshots of every screen in both modes attached.
