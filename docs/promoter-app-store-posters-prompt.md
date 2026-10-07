# Claude Design prompt — App Store posters, Fuoco For Promoters

Paste everything below the line into Claude Design (`/design`). It is written to
stand alone — it assumes no knowledge of this repo.

---

Create a design canvas with **five App Store screenshot posters** for **Fuoco For Promoters**, the iOS app nightlife promoters in Barcelona use to run their own guest lists. Each poster is a headline over an iPhone frame, and **you draw the app screen inside the frame** — an idealized render of the real interface, described screen by screen below. Draw it as vector UI, not a photo of a phone.

**Artboards**

Five portrait artboards, **1320 × 2868 px** (iPhone 6.9"), left to right in order. They're seen as a swipeable strip, so the set must read as one thing: identical background, grid, type scale and device position on every board. Only the headline and the screen inside change.

## Brand — exact values, taken from the app itself

- Background `#0A0807` (warm near-black). Card and lifted surfaces `#15110E`.
- Text `#F4ECDD` (warm parchment). Dim text = same colour at 60%. Faint = 20%. Hairlines = 10%, 1px.
- Accents: gold `#C09950`, flame `#E8B65B`, ember `#C2562D`. Deep red `#8C2A2A` only as glow or shadow, never type.
- **Never pink, purple or blue.** Night plus firelight, nothing else.
- Display: **Instrument Serif**, often *italic* — the brand's voice. Tight leading, generous size, never all-caps.
- Labels: monospace (Geist Mono or similar), uppercase, ~0.2em letterspacing, small. The app calls these "kickers" and they're usually gold or dim parchment.
- Body/UI: Inter or similar neutral sans, 15px medium for row titles, 11–12px for sublines.
- Corner radii in the UI: 14 for rows and fields, 18 for cards, 28 for pills.
- Texture: faint warm radial glow behind the device, like light off a bar, plus subtle film grain. Restrained and expensive — a candlelit room at 2am, not a rave flyer.

## Shared anatomy of every poster

1. Mono kicker, uppercase, gold, top of the board.
2. Serif headline under it — parchment with one or two words in gold italic. Two lines max.
3. One short sans supporting line, dim parchment.
4. One iPhone frame, bottom ~60%, holding the drawn screen. Fully inside the board on poster 1; cropped by the bottom edge on 2–5 so the strip feels continuous.
5. 120px clear on every side; nothing important within 160px of the bottom.

## The app's UI vocabulary — reuse on every screen you draw

- **App header:** "Fuoco" in Instrument Serif ~28px, a small circular avatar with initials on the left, gear and bell icons on the right, hairline underneath.
- **Kicker:** mono uppercase label above a section.
- **Row card:** `#15110E` fill, radius 14, 1px hairline stroke, 12px padding.
- **Icon tile:** 40×40, radius 10, ember at 15% opacity, ember icon inside.
- **Stat card:** small mono uppercase label over a large serif number.
- **Tab bar** at the bottom of full screens, four items: **Tonight · Guestlist · Stats · You** (moon, list, bar-chart, person). Active tab in ember, the rest dim.

## One night, told across five posters — use this data everywhere

The same night, so the strip tells one story. Keep every number consistent.

- Venue **Opium Barcelona**, night **Fuego Saturdays**, Saturday 14 March, 120 spots.
- **86 of 120** spots used, **54 checked in**.
- Guests: María Solé (+2 guests), Àlex Ferrer, Nuria Camps (+1 guest), Leo Márquez, Paula Ortiz (+3 guests).
- Staff links: Dani — 24 brought, Clara — 18 brought, Marc — 11 brought.
- This month: 412 guests, 287 arrived, 70% check-in, €1,240 earned (€980 nights, €260 offers).

## The five posters

### 1 — Tonight
Kicker `FUOCO FOR PROMOTERS` · Headline "Run *your* night." · Line "The guest list app for approved Barcelona promoters."

Draw the home screen: app header; "Tonight." as a large serif heading; a venue group headed by a small ember building icon and **Opium Barcelona** in serif 22; under it a row card — icon tile with a moon-and-stars glyph, "Fuego Saturdays" in sans 15 medium, "Private event" beneath in 11px dim, **86/120** on the right in flame-coloured mono, chevron; below it a second, shorter row with a repeat glyph reading "Permanent link · Saturdays". Then kicker `UPCOMING THIS WEEK` and two slim rows divided by hairlines. Tab bar with **Tonight** active.

### 2 — Create a night
Kicker `BUILD A NIGHT` · Headline "A list in *minutes*." · Line "One-off or a recurring weekly, set up once."

Draw the create sheet: a sheet lifted over the dark background with a grab handle. Kicker `YOUR CLUBS` over a horizontal row of venue chips, **Opium Barcelona** selected with a gold ring. Kicker `SCHEDULE` over a two-option segmented control, "Weekly" selected, with a row of weekday letters where **S** (Saturday) is lit in ember. Kicker `SPOTS` over a stepper showing **120** flanked by −5 −1 +1 +5 buttons. Kicker `PLUS-ONES PER GUEST` over a small stepper at 2. A gold pill button at the bottom reading **Create guestlist**.

### 3 — One link
Kicker `ONE LINK` · Headline "Share it. *Watch it fill.*" · Line "Staff links show you who brought whom."

Draw the share screen: a large card, radius 18, holding the invite — the night's name, the venue, and a share glyph — with the caption "Same link every week — always opens the next date." underneath in dim 11px. Below it a second card: kicker `STAFF LINKS` over three rows — Dani, Clara, Marc — each with a small avatar circle, the name, and "24 brought" / "18 brought" / "11 brought" on the right in mono.

### 4 — The door
Kicker `THE DOOR` · Headline "Check them in *live*." · Line "Guests and plus-ones, with a running count."

Draw the guest list: night title in serif at the top; two stat cards side by side — `USED` over **86 / 120**, `CHECKED-IN` over **54**; a search field with placeholder "Search guests…"; then the guest rows, each an avatar circle, the name in sans 15, "+2 guests" beneath in dim where they have plus-ones, and on the right either an ember "01:24" arrival time with a filled ember dot on the avatar, or `PENDING` in dim mono. Make the first three arrived and the last two pending, so the check-in state is legible at a glance.

### 5 — Your numbers
Kicker `YOUR NUMBERS` · Headline "Know what you *earned*." · Line "Arrivals, check-in rate and earnings, per night."

Draw the stats screen: "Stats." as a serif heading; kicker `GUESTS THIS MONTH` over a very large serif **412**, with "287 arrived" beside it and a `70% CHECK-IN` pill in mono; kicker `EARNINGS` over **€1,240** in large serif, with "€980 nights" and "€260 offers" as two small mono lines, and "All-time €7,410" dim beneath. Tab bar with **Stats** active.

## Rules

- Headlines must survive being 120px wide in the App Store carousel. Five words max, huge, high contrast. Poster 1 carries the pitch — most people never swipe past the second, so give it the most air.
- The drawn UI must match the real app: these screens, these four tabs, these features. Idealize it — full lists, perfect data, no loading spinners, no empty states, no error text — but invent no feature that isn't described above.
- The figures above are sample data. Keep them consistent across all five posters and don't add awards, ratings, testimonials or press quotes.
- No Apple hardware chrome details, no "Download on the App Store" badge, no emoji.
- Tone: a professional tool for people who work nights. Confident and quiet. Not playful, not corporate, no exclamation marks.

Give me the five artboards on one canvas so I can adjust headlines and nudge the drawn UI directly.
