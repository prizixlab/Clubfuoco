# Porting method: SwiftUI → Compose

How the Club Fuoco iOS app is being translated to Android, and why it is done
this way rather than screen-by-screen from scratch.

The short version: **sort the code into three tiers and use a different
technique on each.** Most of the risk lives in one tier, and that tier can be
verified mechanically instead of by eye.

---

## Tier 1 — Pure logic → port literally, then prove it with golden vectors

These files have no UI and no platform dependency. They are also where a port
goes wrong *invisibly*: nothing crashes, the app just ranks venues differently
or shows an offer on the wrong night, and nobody notices for weeks.

Currently in this tier (all Foundation-only, verified with a grep for framework
imports):

| File | Lines | What breaks if it drifts |
|---|---|---|
| `Core/Utils/ValidDays.swift` | 110 | Offers appear on the wrong nights |
| `Features/Explore/ShelfBuilder.swift` | 291 | Feed ranks differently from web/iOS |
| `Features/Explore/PersonalizationScore.swift` | 186 | Personalisation silently diverges |
| `Features/Rumbalist/FuocoScore.swift` | 44 | A venue shows a different rating per platform |
| `Models/Place.swift` (the `Hours` enum) | ~110 | "Open tonight" disagrees across clients |
| `Models/ExternalEvent.swift` (`VenueMatch`) | 173 | Events attach to the wrong venue |

### The technique

Do **not** hand-write test expectations. A hand-written expectation can agree
with a hand-written port and both be wrong about what the app actually does.

Instead, compile the **real Swift source** together with a tiny generator, run it
over a corpus, and dump JSON:

```bash
./scripts/parity/run.sh          # regenerates vectors from ios-native
./gradlew :app:testDebugUnitTest # asserts Kotlin matches them
```

`scripts/parity/main.swift` is ~20 lines: a corpus array, and
`ValidDays.parse($0).sorted()`. It is compiled against
`ios-native/.../ValidDays.swift` itself, so the vectors are ground truth by
construction.

### Mutation-test the corpus, or it proves nothing

The first `ValidDays` corpus had 59 vectors and **failed to catch** a port that
swapped prefix-matching for substring-matching — a completely plausible mistake.
The corpus only became meaningful after adding adversarial inputs: segments that
*start* with a late-order day and also *contain* an early-order one
(`"Sat night sundowners"`, `"frimon"`, `"wednesday sunrise"`).

So the workflow is:

1. Write the Kotlin port.
2. Generate vectors, watch them pass.
3. **Deliberately break the port** in a plausible way.
4. If the tests still pass, the corpus is too weak — add discriminating inputs
   and go back to 2.

This found a real behavioural quirk nobody had written down: `"Sunset sessions"`
parses as **Sunday**, because `"sun"` prefixes it. That is now pinned by a named
test so a future "fix" has to be a deliberate four-platform decision.

> Note: `ValidDays.swift` on iOS has no test target at all — its contract lives
> in `assert()` calls inside `#if DEBUG`. The Android parity suite is currently
> the only executable check that any of the four implementations agree.

---

## Tier 2 — Data & queries → mechanical, driven by shared column lists

Models and `Queries` translate almost one-for-one, because both sides are
constrained by the same thing: the PostgREST column list, which is a literal
string shared between the implementations.

Rules that have held up so far:

- **Copy the `select(...)` column list verbatim.** It is the contract. Reformat
  the whitespace, never the columns.
- `Codable` + `convertFromSnakeCase` → `@Serializable` + `@SerialName` on the
  fields that differ. kotlinx has no global snake_case strategy, so this is
  explicit per field.
- Swift `Codable` throws on unknown keys by default; Kotlin needs
  `ignoreUnknownKeys = true` to match the tolerance the app relies on.
- **Custom decoders port as custom serializers, and they matter.** `opening_hours`
  arrives as an array, a JSON-encoded string, or a plain string depending on the
  row — `FlexibleStringArraySerializer` exists for exactly that, and decoding
  strictly would silently drop hours for a slice of venues.
- Optional-with-default (`let x: Int?`) → `val x: Int? = null`. Kotlin will not
  supply the default for you.

---

## Tier 3 — UI → build the primitives first, then screens are composition

Do not translate screens one at a time from scratch. Port the **shared
vocabulary** first; after that each screen is assembly rather than translation.

Already in place (`core/designsystem/`):

`Theme` (the whole palette, light/dark pairs) · `InstrumentSerif`/`Geist`/
`GeistMono` · `Kicker` · `AuthField` · `PrimaryButton` · `SegmentedProgress` ·
`BackChevronButton` · `FormError` · `ShimmerBlock` · `FuocoTextField` ·
`clickableUnlessBusy`

### Idiom map

| SwiftUI | Compose | Note |
|---|---|---|
| `@State` | `var x by remember { mutableStateOf(…) }` | |
| `@Observable` class | plain class with `mutableStateOf` properties | No ViewModel needed; matches the iOS store shape |
| `@Environment(Store.self)` | pass explicitly, or a `CompositionLocal` | Explicit params have been clearer so far |
| `VStack` / `HStack` / `ZStack` | `Column` / `Row` / `Box` | |
| `spacing:` | `verticalArrangement = Arrangement.spacedBy()` | |
| `.padding(.init(top:leading:…))` | `.padding(start=, top=, end=, bottom=)` | Compose is start/end, not leading/trailing |
| `.background(c, in: .rect(cornerRadius:))` | `.clip(RoundedCornerShape(r)).background(c)` | **Clip before background**, or corners don't round |
| `.overlay(RoundedRectangle().stroke())` | `.border(w, c, shape)` | |
| `Color.adaptive(light:dark:)` | palette object behind a `CompositionLocal` | Compose has no dynamic colour primitive |
| `.font(.cfSans(13, weight:.medium))` | `fontFamily = Geist, fontWeight = …, fontSize = 13.sp` | Geist's weights are one family here, not separate ones |
| `Text(a).italic() + Text(b)` | `buildAnnotatedString { withStyle(SpanStyle(...)) }` | |
| `NavigationStack(path:)` | `NavHost` + `rememberNavController` | |
| `.sheet` / `.fullScreenCover` | `ModalBottomSheet` / full-screen route | |
| `.task { }` | `LaunchedEffect(key) { }` | `.task` re-fires on reappear; `LaunchedEffect` needs a key |
| `.buttonStyle(.plain)` | `clickableUnlessBusy` (no ripple) | Material ripple makes ported surfaces look generic |
| `LocaleStore.t("a.b")` | `stringResource(R.string.a_b)` | Generated; see below |
| `String(format:)` with `%@` | `%s`, positional `%1$s` when >1 arg | Android *requires* positional for multi-arg |

### Gotchas that cost real time

- `stringResource` is `@Composable` — it **cannot** be read inside a click
  handler. Hoist it to a `val` above the layout.
- `var i = nullableInt` after a null check infers `Int?` and loses the smart
  cast. Annotate: `var i: Int = a`.
- Compose modifier order is semantic. `.clip().background()` ≠
  `.background().clip()`.

---

## Localization: generated, never hand-maintained

`scripts/gen-strings.py` rebuilds all four `values*/strings.xml` from the iOS
String Catalog, which stays the single source of truth for copy. Dots become
underscores, `%@` becomes `%s`, multi-arg strings get positional indices, and
literal-percent strings get `formatted="false"`.

Re-run it whenever the catalog changes — it already caught one drift (635 → 661
keys) mid-port. `res/values/app.xml` holds the few hand-written Android-only
strings so the generated file can be overwritten freely.

---

## What is deliberately NOT automated

**Transpiling SwiftUI to Compose.** The output would be unmaintainable, and the
value of this port is partly that it is a chance to fix things — the two
`PushRegistrar` bugs were caught precisely because the code was read and
re-thought rather than mechanically converted.

**Screen-for-screen fidelity of layout code.** Compose has different layout
primitives; chasing pixel-identical structure produces awkward Kotlin. Match the
*design*, not the view hierarchy.
