# Android — device test sheet & setup blockers

Running notes for the Android port. Two lists: things that **cannot be verified
without a physical phone**, and **external setup** (accounts, keys, files) that
has to exist before certain features can work at all.

Keep this file honest — tick items off as they're actually verified on hardware,
not when the code is written.

---

## How to build and install

```bash
cd android-native && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew :app:installDebug
```

Toolchain on this Mac (installed 2026-08-28):

| Piece | Version | Location |
|---|---|---|
| JDK | OpenJDK 21.0.12.1 | `/opt/homebrew/opt/openjdk@21` (keg-only; export `JAVA_HOME`) |
| Android SDK | platforms 35 / 36 / 37.0, build-tools 35 / 36 / 37 | `/opt/homebrew/share/android-commandlinetools` |
| Gradle | 9.7.1 (wrapper committed) | `./gradlew` |
| Android Studio | installed | `/Applications/Android Studio.app` |
| AGP / Kotlin | 9.3.2 / 2.4.10 | `gradle/libs.versions.toml` |

Note: Homebrew's `temurin@21` cask needs `sudo` and failed; the `openjdk@21`
**formula** is what's actually installed. AGP 9 dropped the standalone Kotlin
plugin (Kotlin is built in) and removed `kotlinOptions` / `resourceConfigurations` —
the build files already account for all three.

---

## A. Needs a physical Android phone

Nothing here can be trusted from an emulator.

### A1. Push notifications (FCM)
- [ ] Token is issued and lands in `device_tokens` with `app='clubfuoco'`, `platform='android'`
- [ ] Token uploads on the **first** launch after signup — the iOS app has a bug
      here (registers while signed out, never retries), and `PushRegistrar.onSignedIn()`
      is the Android fix. Verify it actually fires.
- [ ] Sign out deletes the row (`onSignedOut`) so a shared phone stops receiving
      the previous user's pushes — also an iOS bug not carried over
- [ ] Notification permission prompt (API 33+ runtime permission; iOS has no equivalent gate)
- [ ] Foreground vs background delivery both render

### A2. Geofenced arrival check-in
- [ ] Background location permission ladder: foreground grant first, then the
      separate background request. Android shows a **different** flow to iOS's
      "Change to Always Allow" — needs real-world walkthrough
- [ ] Geofence actually fires on venue arrival and posts `user_checkin`
- [ ] Fences survive an app kill and a reboot (`BootReceiver`)
- [ ] **Carry over the iOS fix:** iOS only registers a fence once the night's
      window has already opened, so a booking made at noon for 10pm never arms if
      the app isn't reopened. Android should register ahead of time and let the
      server reject out-of-window signals.

### A3. Google Pay → Stripe
- [ ] Google Pay sheet presents at all (needs a real device with a saved card)
- [ ] Test card completes the Rumbalist VIP flow end-to-end
- [ ] **The live Stripe key rejects emulator/test tokens** — same trap as
      Apple Pay in the simulator

### A4. Google Wallet passes
- [ ] Booking pass adds to Google Wallet
- [ ] Promoter-invite pass adds (on iOS this one wrongly opens in Safari
      instead of the native sheet — do it natively here)

### A5. Deep links
- [ ] App Links (`https://clubfuoco.com/i/<token>`) open the app directly — requires
      assetlinks.json, see B4
- [ ] Custom scheme `clubfuoco://i/<token>` works from Instagram/TikTok in-app browsers
- [ ] Install-handoff: tap a link with the app absent, install, launch, and the
      invite is recovered. **Android uses the Play install referrer, not iOS's
      clipboard read** — needs B8, and can only be tested through a real Play
      install (internal testing track), never a sideload
- [ ] A link tapped while the app is already open swaps the claim screen to the
      new invite rather than stacking a second one

### A6. Auth  ← **built, needs verification**
- [ ] Welcome splash: fire glow renders, all three CTAs are visually peer-level
- [ ] Guest mode enters the app with no session (anonymous sign-up 500s in prod —
      the failure must stay swallowed, not block entry)
- [ ] Email sign-in, including the silent retry on a flaky connection
- [ ] Signup wizard: details → email OTP → birthday + gender → survey offer (A10)
- [ ] Signup with an already-registered email shows "email taken" on the DETAILS
      step, not an OTP screen that never receives a code
- [ ] 18+ birthday gate rejects an underage date
- [ ] Password recovery: send code → verify → set new password. **Needs the
      Supabase "Reset Password" template to include {{ .Token }}** or no code is
      ever emailed
- [ ] Google Sign-In via Credential Manager (needs SHA-1 registered, see B2)
- [ ] A promoter account is signed out rather than admitted to the consumer app
- [ ] Complete-profile gate catches an existing user whose row predates the
      gender field, and does NOT catch someone mid-signup-wizard
- [ ] Session survives app kill; a revoked refresh token signs out cleanly rather
      than leaving a zombie signed-in UI

### A7. General device behaviour
- [ ] Fonts render (Instrument Serif + Geist) — verify the serif italic resolves
- [ ] Dark mode across every screen
- [ ] All four languages, including the in-app override beating the system locale
- [ ] Back gesture / predictive back
- [ ] Edge-to-edge insets on a notched device

### A8. Promoter invite claim  ← **built, needs verification**

The App Store funnel, and for a lot of people the first screen they ever see.

- [ ] A tapped invite covers everything — including the auth flow — so someone
      who installed because a friend listed them lands on the list, not a wizard
- [ ] Name pre-fills from the profile when signed in
- [ ] "Add a spot" up to the promoter's cap, and no further
- [ ] An open spot assigned to a friend FLIPS (it does not add) — the party total
      must never exceed the cap whichever way spots are filled
- [ ] A friend already going, or already on a slot, is hidden from the picker
- [ ] Claim on a free night → ticket with a scannable QR (`fuoco-invite:<id>`)
- [ ] Claiming while signed OUT works, then "Keep this spot" + Google binds it,
      and it appears in Tickets afterwards
- [ ] If the bind fails, the copy says the QR still works — it does; verify at a
      scanner rather than trusting the message
- [ ] Paid night: the PRICE is on the button, and for a party the button shows
      the party total, not the per-head price
- [ ] Paid night: "save it, pay later" says plainly that a save holds nothing
- [ ] Stripe return (`?paid=1&guest=`) lands on the ticket, not back on the form
- [ ] Ticket polls: a friend accepting flips INVITED → GOING within ~12s without
      a manual refresh
- [ ] Roster count is HEADS (a guest with 3 plus-ones counts as 4)
- [ ] Share sheet sends the `clubfuoco.com/i/<token>` link — the brand domain,
      not the API host
- [ ] Removing an open spot patches the server and reverts visually if refused

### A9. Morning-after review  ← **built, needs verification**

- [ ] Tickets/Reviews swipe between pages; the Reviews tab badge counts pending
- [ ] A booking appears here only from yesterday back to 7 days — not tonight's,
      not last month's
- [ ] A booking whose attendance is already settled (verified, no-show, disputed)
      never appears
- [ ] "I didn't go" posts `did_not_go` and closes — NO further questions
- [ ] "Yes, I went" records `post_entry_got_in` immediately, before the rest of
      the review. Abandon the survey right there and attendance should still be
      claimed
- [ ] Continue stays disabled until each step is actually answered
- [ ] Drink accordion: picks and free text both count toward a category, and the
      per-drink ratings step lists exactly what was picked
- [ ] Submit writes the survey, then fires the attendance signal; a rejected
      signal on an older booking must NOT fail the submit
- [ ] Card disappears the instant a review is submitted or dismissed, without
      waiting for a refetch
- [ ] Dismiss persists — pull to refresh, kill the app, it stays gone
- [ ] With the app set to Spanish: the category labels and every line of copy
      translate, but the drink names and music genres stay English on the wire.
      Check the saved row, not just the screen — a translated `Negroni` would
      split one drink into four in the per-club rankings

### A10. Onboarding survey  ← **built, needs verification**

- [ ] Signup now ends on the two-card offer; the dark "personalize" card is the
      visual default and the plain one goes straight in
- [ ] Backing out of the survey returns to the offer, not out of signup
- [ ] Vibes cap at 3 — a 4th tap does nothing, and the running count is visible
      BEFORE the cap is hit
- [ ] Custom genre / vibe appears as a normal chip and can be un-picked again
- [ ] A custom drink typed into Beer stays under Beer, not Other, across a
      rotation or any other recompose
- [ ] "I don't really care" stores the CATEGORY key and clears that category's
      individual picks — check the saved row; `beer` means any beer, an empty
      beer category means unanswered, and the feed scores those differently
- [ ] Budget slider steps in 5s; "No limit" hides the slider entirely
- [ ] "Skip for now" and a failed save BOTH still land in the app — nobody is
      locked out over a preferences POST
- [ ] After completing it, the Explore feed's shelves actually change (that is
      the entire point of the survey)
- [ ] Step label reads 4/04 on the final step, not 4/03 — the iOS catalog string
      bakes the total in and would get this wrong

### A11. Events  ← **built, needs verification**

Our own nights — promoter nights and house nights — as opposed to the scraped
listings on a venue page.

- [ ] A PINNED event takes the big card at the head of the featured box; an
      unpinned one mixes into the rail instead of displacing the venue hero
- [ ] With nothing pinned, the venue hero leads exactly as it did before
- [ ] Only ONE corner badge per card, in priority order: tonight → our pick →
      ours. A paid promotion must show NO badge (the promoter buys rank, not a
      label telling guests they paid)
- [ ] A night that moves shows the whole route ("Bastión → Opium") wherever a
      card would print a venue — never just the first stop
- [ ] Event page: the schedule timeline appears only on a route, and a stop at
      one of our venues opens that club page; a free-text stop is plain
- [ ] Line-up is numbered with the headliner larger; a credit we hold in the DJ
      catalogue opens the artist page, one we don't is plain text with no chevron
- [ ] Reserve on a free night → pass appears immediately with a scannable QR
- [ ] The reserved button asks before giving the spot up
- [ ] Cancel frees the spot and re-checks capacity
- [ ] A PRICED night shows "Buy · €X", never Reserve — the reserve route refuses
      anything priced, so an RSVP button there is a guaranteed error
- [ ] Ticket ladder: the live wave's price is large, the next wave's price and
      when it starts is stated plainly, spent waves are dimmed
- [ ] "N left" appears only on a live, limited wave
- [ ] No dock at all on an event with no `clubId` — there is nothing to book
      against
- [ ] Add to calendar opens the phone's calendar app pre-filled, and a close time
      earlier than the open lands on the NEXT morning
- [ ] The reserved spot then behaves like any booking: Tickets tab, check-in, and
      the morning-after review (A9)

### A12. Booking pass & arrival check-in  ← **built, needs verification**

- [ ] Tapping a ticket card opens the full pass page; "Show QR" still works as
      the fast path
- [ ] The QR encodes `scan_token` and the printed code underneath is THE SAME
      token, grouped in fours. Scan it at a real reader — the CF- reference does
      not open a door and must never appear here
- [ ] Check-in card is absent before the venue opens, shows "I'm here" inside the
      window, and flips to "Did you get in?" for two hours after it closes
- [ ] A booking with a `cutoff_time` (rumba list) ends its window at cutoff + 3h,
      not at club closing — and a cutoff after midnight lands on the NEXT day
- [ ] First "I'm here" tap asks for location; granting it posts the check-in
      straight away without a second tap
- [ ] Denying location shows the "couldn't read your location" line, not a
      silent failure
- [ ] Server refusals read in plain words: too far, not open yet, no venue
      location
- [ ] "Had an issue" lists all seven reasons and posting one closes the list
- [ ] Once attendance resolves, the card collapses to a quiet confirmation with
      no buttons
- [ ] `pass_viewed` fires silently on opening a pass **only when location was
      already granted** — it must never trigger a permission prompt
- [ ] Cancel asks inline before giving the booking up
- [ ] Add to calendar pre-fills the venue, the date and the doors time

### A13. Photos, saved events, location prompts  ← **built, needs verification**

- [ ] Tapping the club hero opens the fullscreen viewer at photo 1; tapping the
      third thumbnail opens at the RIGHT photo, not one off
- [ ] Pinch zooms, drag pans, and a zoomed photo cannot be dragged off screen
- [ ] Double-tap zooms in and out again
- [ ] Swiping to the next photo resets the previous one's zoom
- [ ] A saved-but-unpaid night appears above the tickets with a DASHED edge, no
      QR, and the price as an action ("Pay €15") — it must be impossible to
      mistake for a ticket
- [ ] Tapping one reopens the invite screen so it can be paid for
- [ ] Nearby location prompt appears ONCE on the first Explore open, never again,
      and not at all if location was already granted
- [ ] "Not now" dismisses without asking the system, and does not come back
- [ ] Settings → arrival check-in opens the two-step explainer; with foreground
      already granted it skips straight to the Settings step rather than showing
      a dialog that would do nothing
- [ ] "Open Settings" lands on THIS app's permission page
- [ ] The step copy names Android's buttons ("While using the app", "Allow all
      the time"), never Apple's

### A14. DJ preview player  ← **built, needs verification**

Drives a hidden SoundCloud widget behind our own gold controls. The riskiest
piece on the whole port to verify from a desk, because none of it can be proven
without real audio on real hardware.

- [ ] **Audio actually plays.** The web view is attached off-screen to the window
      for exactly this reason — Android throttles detached and collapsed web
      views. If playback is silent or never starts, that attachment is the first
      thing to check
- [ ] Play/pause responds on the first tap, with no second gesture needed inside
      the iframe
- [ ] Track title and duration appear within a second or two, not "Loading…"
      forever with a live 0:00 / 0:00 underneath
- [ ] A DJ with a dead or empty profile shows "Preview unavailable" with a
      struck-through button and NO times — it must not spin
- [ ] A malformed handle (some rows hold a URL pasted into itself) renders no
      player card at all
- [ ] Dragging the waveform scrubs, and seeking lands where the finger left off
      rather than firing a request per pixel
- [ ] Opening a SECOND DJ swaps profiles on the warm widget — the second open
      should be visibly faster than the first
- [ ] Leaving the DJ page stops the audio
- [ ] Backgrounding the app stops the audio; there is deliberately no background
      or lock-screen playback
- [ ] SoundCloud does NOT appear in the socials row — the player replaces it

### A15. Phone number & booking help  ← **built, needs verification**

- [ ] Signup and the complete-profile gate both ask for a phone number, with the
      country picker defaulting to Spain
- [ ] The picker searches by country name AND by dial code ("+351", "351")
- [ ] Switching country re-caps the number — a 10-digit US number switched to
      Norway (8) must lose the tail, not save an impossible number
- [ ] The saved value carries the dial code ("+34 612345678"). Check the row,
      not the screen: a number stored without its code is one the door cannot ring
- [ ] Settings shows an existing number correctly on open. This is the case iOS
      got wrong twice — the profile arrives from an async fetch AFTER first
      composition, and a one-shot parse leaves the field blank, which reads as
      "phone numbers don't save"
- [ ] A number already on another account is refused with a clear message.
      **`phoneIsTaken` was never called anywhere on Android before this** — verify
      it actually fires
- [ ] It fails OPEN: with the RPC unreachable, signup still completes
- [ ] The "?" on a pass opens help; the CF- reference is shown ABOVE the topics
- [ ] The reference shown is `qr_code_token`, NOT the scan token — the door
      secret must never appear on a screen someone might photograph
- [ ] Picking a topic reveals the note box; sending posts to /api/support with
      the topic and booking id attached
- [ ] Every topic row shows real words. **On iPhone these render as literal
      dotted keys** ("help.refusedBody") because 14 keys are missing from the
      catalog — see section C

### A16. Event detail sheet  ← **built, needs verification**

Opened by tapping an event card on a venue page. Built against measured
coverage of the real data, so the four states below are the actual test:

- [ ] **rich** — flyer, copy, several linked DJs, age, capacity: everything renders
- [ ] **no lineup** — 29% of events bill nobody. The section must SAY so, not
      render empty
- [ ] **floor** — no flyer and no copy: title, time, venue and promoter only, with
      no gaps where the missing pieces were
- [ ] **unlinked** — credits that are real names but not DJs we hold: listed,
      dimmed, not tappable, no chevron
- [ ] `cost` and `venue_capacity` both lie in the source. A chip appears ONLY for
      a real number — never "0", "€", "TBC" or prose
- [ ] A night ending after midnight shows "+1" beside the hours
- [ ] Description clamps at 5 lines with a read-more; short copy (under 40 chars)
      shows no section at all
- [ ] Tapping a lineup row opens the DJ ON TOP of the event — closing the DJ
      returns to the event, not to the venue page
- [ ] The whole row is one tap target, including the gap between the name and
      the chevron
- [ ] The card body opens the sheet, but a lineup chip on the card still goes
      straight to that DJ

### A17. Booking a night  ← **built, needs verification**

- [ ] The Book CTA appears ONLY on a venue that sells something — a row with no
      entry price and no table minimum must show nothing
- [ ] General/VIP toggle appears only where there is a table minimum; a
      tables-only venue defaults to VIP
- [ ] Date list covers today through +14, the same window the server enforces
- [ ] Party size clamps at 1 and 20 from both the buttons and any other route
- [ ] A free general-entry night says "free guestlist" instead of printing
      "€0.00" three times
- [ ] **Plan with friends works end to end** — creates the group, shows the
      invite code, and the group is in Tickets afterwards
- [ ] A general-entry group sends `organizerPays: false` (free guestlist, paid at
      the door); a VIP group sends true. Check the request, not the screen
- [ ] The card path states Google Pay is not configured rather than offering a
      button — nothing here should ever produce a payment error
- [ ] Signed out, the CTA opens the guest gate instead of the sheet

---

### A18. Supplier lockup  ← **built, needs verification**

This is contractual credit, not decoration — a supplier whose mark is missing
from a surface their offer appears on has a complaint, so every placement
matters.

- [ ] Venue page, a supplier offer row: the mark sits after the "·", at text
      size, in the supplier's own colour — and the row still fits on a narrow
      phone without the offer title being squeezed out
- [ ] Offer sheet header: the supplier's mark, not its name in caps. With no
      supplier the header reads "CLUB FUOCO" as before
- [ ] Offer sheet details card, top row: "Pay to / Operator — Club Fuoco · via
      \<mark\>". Club Fuoco must be named first; it is the merchant of record even
      when the offer came from a supplier
- [ ] Booking pass: the lockup panel sits under the facts strip, in a soft tint
      of the supplier's colour, and the hero small print still shows the
      attribution label
- [ ] **Rumba specifically**: the bundled wordmark, with a gloss band sweeping
      left to right on a ~3.4s loop, on the pass and the sheet header. The two
      small 11dp marks must NOT animate
- [ ] Any other supplier: its remote logo, repainted in the surrounding text
      colour so a light-ink logo is not invisible on the light venue page
- [ ] A supplier with no logo set falls back to its name in the accent colour —
      never to blank space
- [ ] Nothing here is hard-coded per supplier: change the colour in the Partner
      Portal and every mark except Rumba's bundled glyph follows on next launch
- [ ] Scrolling the pass with the gloss running stays smooth (the sweep runs in
      its own compositing layer and should not cost frames)

---

## B. External setup blockers

These are accounts and files I cannot create — each one gates a feature.

### B1. Firebase project + `google-services.json` — **blocks all push**
Create a Firebase project, add an Android app with package
`com.clubfuoco.app` (and `com.clubfuoco.app.debug` for debug builds), download
`google-services.json` into `android-native/app/`.
The build is written to work without it — the Google Services plugin is applied
conditionally — so push simply stays inert until the file lands.

### B2. SHA-1 / SHA-256 fingerprints — **blocks Google Sign-In**
Register the debug and release signing certificate fingerprints in both the
Firebase project and the Google Cloud OAuth client. Debug fingerprint:
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

### B3. Release keystore — **blocks any Play upload**
No signing config exists yet; `assembleRelease` produces an unsigned APK. Needs a
keystore created, stored outside the repo, and referenced from a gitignored
`keystore.properties`. **Losing this keystore is unrecoverable** unless Play App
Signing is enabled — enable it.

### B4. `assetlinks.json` — **blocks App Links verification**
Serve `/.well-known/assetlinks.json` from clubfuoco.com with the app's package
name and signing fingerprint. Without it, links open in the browser instead of
the app. The iOS counterpart (AASA) already exists for the same domain.

### B5. Google Play Console — **blocks release**
Developer account, app listing, store assets. Play needs its own screenshots and
feature graphic; the App Store set is the wrong aspect ratio.

### B6. Google Pay / Stripe — **blocks payments**
Google Pay merchant configuration, and Stripe's Android SDK pointed at the same
publishable key the iOS app uses.

### B7. Google Wallet issuer account — **blocks wallet passes**
Entirely separate from Apple's pass certificate: needs a Google Wallet API
issuer id and a service account, plus a server-side pass-generation endpoint.
The existing `/api/bookings/<id>/wallet` returns a `.pkpass`, which Google Wallet
cannot read — **this needs a new backend route**, not just client work.

The invite ticket therefore has NO wallet button at all on Android, where iOS
shows "Add to Apple Wallet". Offering one that hands someone a file their phone
cannot open would be worse than not offering it.

### B8. Install referrer on the `/i/<token>` page — **blocks deferred invites**

When the branded invite page sends an Android visitor to Play, the store link
must carry the token:

```
https://play.google.com/store/apps/details?id=com.clubfuoco.app&referrer=invite%3D<token>
```

Play passes that string through verbatim to the fresh install, and the app reads
it on first launch. **This is strictly better than what iOS has to do** — Apple
offers no deferred deep link, so the iOS app reads the CLIPBOARD and falls back
to a coarse IP + OS-version fingerprint on the server, a guess that can hand
someone a stranger's invite. Android needs neither: no paste prompt, no
fingerprint, no collisions.

The client half is built. Until the web page appends the parameter, the deferred
path simply finds nothing, which costs nothing — the link is still in the
guest's messages and tapping it works.

Note the server-side fallback (`/api/invite-handoff/claim`) is iOS-only by
construction: `src/lib/invite-handoff.ts` hardcodes `'ios'` into the fingerprint
and `looksLikeIOS()` refuses to record anything else. Android deliberately does
not call it.

---

## C. Known deltas from iOS (deliberate)

- **Version train is independent.** Android starts at versionCode 1 / versionName
  1.0. It owes nothing to the App Store's 1.1x numbering.
- **Notification channels** exist (Android requires them, iOS has no equivalent).
  Channel ids are permanent — renaming one orphans the user's settings.
- **Morning-after prompts use AlarmManager**, which does not survive reboot, hence
  `BootReceiver`. iOS's `UNCalendarNotificationTrigger` needs no such repair.
- **Morning-after copy is localized here** (`review_promptTitle` / `review_promptBody`
  in `res/values/app.xml`). iOS hardcodes it in English — worth back-porting.
- **The invite claim screen is localized here.** `InviteClaimView.swift` has 47
  English literals and zero catalog lookups — the one screen in the iOS app with
  no localization at all, and the one most likely to be a stranger's first
  contact with Club Fuoco. The Android keys (`invite_*` in `res/values/app.xml`)
  are written to be lifted straight into the iOS catalog. The same is true of
  the morning-after review (`review_*`, `drinks_*`), the onboarding survey
  (`survey_*`) and the arrival check-in card (`attend_*`). Four whole screens
  where Android is the only localized build, plus the saved-events strip
  (`saved_*`).
- **The iOS help sheet shows raw keys, and Android fixes it.**
  `BookingHelpSheet.swift` looks up `help.refused`, `help.qrBody`, `help.send`
  and 11 others; NONE of those exist in the catalog, so iPhone renders the
  dotted key strings where the copy should be. Android's `help_*` entries in
  `app.xml` are real copy — adding those keys to the iOS catalog fixes iOS with
  no Swift change. `EventDetailSheet.swift` has the same problem in miniature:
  `event.more` / `event.less` are missing too, so that button reads
  "EVENT.MORE" on iPhone.
- **The location ladder's step copy is Android's own** (`location_android*`).
  The catalog strings name Apple's buttons and describe a second in-app dialog
  that Android does not have — from API 30 the background grant is a
  Settings-only choice. Titles and bodies still come from the catalog.
- **`signup_stepOf` replaces the catalog's `signup_stepLabel`**, which bakes the
  step total into the translation ("Step %s / 03") and goes wrong the moment the
  wizard grows a step. Worth back-porting.
- **Deferred invites use the Play install referrer**, not a clipboard read and a
  server-side fingerprint guess. See B8 — this is a genuine Android advantage,
  not a shortcut.
- **`resourceConfigurations` → `androidResources.localeFilters`** and no
  `kotlinOptions` block: both are AGP 9 requirements, not preferences.

---

## D. Port status

**Built and compiling** — `./gradlew assembleDebug` and the parity tests both pass.

- Gradle/AGP 9 setup, wrapper, version catalog resolved against real repos
- **All 661 strings × 4 locales** generated from the iOS String Catalog by
  `scripts/gen-strings.py` (re-run it whenever the iOS catalog changes)
- Design system: full `Theme.swift` palette port with light/dark pairs, brand
  fonts, `ShimmerBlock`, `FuocoImage`
- `ApiClient` — envelope contract, Bearer auth, one-shot 401 refresh+retry
- `SupabaseService` + `Queries` — the direct PostgREST path under RLS
- `AuthStore`, `LocaleStore`, `ThemeStore`, `PlanStore`, `FeedCache`
- `PushRegistrar`, `MorningAfterScheduler`, `GeofenceReceiver`
- **Auth** — welcome, login, signup wizard + OTP, password recovery,
  complete-profile gate, Google via Credential Manager
- **Explore** — `ShelfBuilder`, `PersonalizationScore`, cards, When planner,
  shelf lists, saved venues
- **Club detail** — hero, hours, What's On (featured DJs + events with tappable
  lineups), DJ pages with tour schedules
- **Rumbalist** — offers and the booking sheet
- **Tickets** — bookings, QR passes, groups strip, pending invites
- **Groups** — detail, RSVP, member list, chat, share invite
- **Friends, notifications, fiamme, profile, settings**
- **Promoter invite claim** — deep links, deferred install handoff, claim form
  with friend slots, paid checkout, the ticket, party management, roster
- **Morning-after review** — the Tickets/Reviews pager, the pending window, the
  did-you-go gate, and the seven-step survey
- **Onboarding survey** — the signup offer plus all seven preference steps,
  feeding `PersonalizationScore`
- **Events** — the feed cards, the event page (route timeline, ticket ladder,
  numbered line-up), reserve/cancel, buy, and the reserved pass
- **Booking pass page** — full-screen QR, facts strip, receipt, venue, manage
- **Arrival check-in** — the three-phase attendance card and its signals
- **Photo viewer** — fullscreen pager with pinch, pan and double-tap zoom
- **Saved events** — the unpaid-bookmark strip above the tickets
- **Location pre-prompts** — nearby (once) and arrival (from Settings)
- **DJ preview player** — hidden SoundCloud widget, gold controls, waveform
  scrubber
- **Phone number field** — 201-country picker, dial-code parsing, and the
  uniqueness pre-flight that Android previously never called
- **Booking help sheet** — the "?" on a pass, with the reference above the form
- **Event detail sheet** — tapping an event on a venue page
- **Booking a night** — type, date, party size, totals, and the group path
  (the card path is blocked on B6 and says so)
- **Supplier lockup** — the offer supplier's mark on every surface their offer
  reaches, plus the "Club Fuoco · via …" operator row that names the merchant
  of record
- **Parity tests** — `ValidDays` (68 vectors) and `VenueMatch` (41 pairs)
  asserted against JSON generated from the REAL iOS Swift source, so those two
  ports are proven identical rather than eyeballed. See `docs/PORTING.md`.

**Still to port**

Nothing structural. Every screen in the iOS consumer app now has an Android
counterpart. What remains is verification on hardware (section A) and the
external accounts and keys in section B.

**Deliberately not functional, and honest about it**

- VIP table payment, paid group joins and the pay-now half of booking a night
  all say Google Pay is not configured rather than showing a button that cannot
  work (B6). Booking's GROUP path is unaffected and fully works — a general-entry
  group is a free guestlist settled at the door, so it needs no card at all,
  which is why it is the primary action on that sheet rather than the fallback
  it is on iOS.
- No wallet pass on Android at all (B7), including on the event reserved pass —
  the QR and the calendar are there, the wallet button is not.
- The event page has no blurred collapsing title bar. iOS fades one in over the
  hero as it scrolls; Compose has no cheap `.ultraThinMaterial`, and a fake blur
  over a photo looks worse than the plain back control used here.
