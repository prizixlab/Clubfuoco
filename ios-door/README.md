# Fuoco Door

Staff-facing QR scanner for venue doors — the third Club Fuoco iOS app
(`com.clubfuoco.door`), alongside `ios-native` (consumer) and `ios-promoters`.

Implements **Phase A (detection, no charging)** of the overscan-enforcement plan:
the scan → access → void loop, offline-first operation, and the hard 12-hour
sync ceiling that makes the overscan clause enforceable. See
`../docs/overscan-enforcement-scope.md` for the why.

## Build & run

XcodeGen-managed (like `ios-promoters`). Regenerate the project after changing
`project.yml` or adding files:

```bash
cd ios-door && xcodegen generate
```

Device-only (the scanner uses the camera — no Simulator):

```bash
xcodebuild -project FuocoDoor.xcodeproj -scheme FuocoDoor \
  -destination 'id=<device-udid>' -allowProvisioningUpdates build
xcrun devicectl device install app --device <device-udid> \
  "build/DerivedData/Build/Products/Debug-iphoneos/Fuoco Door.app"
```

## Architecture

```
Core/
  Models/DoorModels.swift     Access Descriptor, NightManifest, QueuedScan
  Repo/DoorRepo.swift         server contract (protocol) + RepoFactory
      MockDoorRepo.swift      in-memory backend — the current default
      DoorAPIRepo.swift       real /api/door/* client (endpoints not built yet)
  Store/DoorStore.swift       manifest cache + append-only queue, persisted JSON
  Sync/SyncManager.swift      12h lock, soft warning, full push+pull sync
      DeviceSession.swift     persisted enrollment (venue + device token)
  Scanner/QRScannerView.swift VisionKit DataScanner wrapper
Features/
  Enroll/                     device enrollment
  Scan/                       camera, verdict result, per-head admit, swipe-void
  History/                    recent scans + swipe-to-void row action
```

### Mock vs. real backend

`RepoFactory.useMock = true` ships an in-memory backend so the whole loop runs
on a device **today**, before the server exists. Demo QR payloads (make QR codes
to test at a door): `PAID-ADA-4`, `VIP-LEO-6`, `GUEST-MIA-2`, `TICKET-JAX-1`,
`MEMBER-GOLD-1`. Enrollment accepts any code in the demo build.

Flip `useMock` to `false` once `/api/door/*` ships — nothing above the repo layer
changes.

## Decisions taken for v1 (the plan's §8 open questions)

| Question | v1 choice |
|---|---|
| Void reason | Friction-free — swipe voids with no required reason (field exists, optional) |
| 12h lock hardness | **Hard block** — scanning locks at 12h; it's the anti-abuse point |
| Party admission | **Per-head stepper** — exact admission count for overscan |
| Auth | Enrolled-device credential bound to a venue (simpler than per-staff logins) |

**Open-access mode (current).** `AppMode.openAccess = true` bypasses enrollment
entirely — anyone opening the app scans/voids straight away. Deliberate while
there are **no partner clubs** to scope a device to (nothing sensitive to guard
yet). Flip it to `false` the day a partner club onboards to restore the
enrollment-code gate. It assumes the mock backend; the server still requires a
device token, so re-enable enrollment (or add a server open-mode) before
pointing at the live API.
| Credentials v1 | All five kinds modelled; paid bookings + guestlist are the real path |

## Server (drafted against the live schema — 2026-08-05)

Written to the real catalog (introspected via PostgREST OpenAPI, not local
migrations). Code lives in the web app repo, not here:

- `supabase/migrations/door_scanner.sql` — new `door_devices`, `admission_scans`
  (de-duped on client `scan_id`), and `bookings.admissions_allowed`. **Apply
  manually in the Supabase SQL editor** (schema drift — do not trust local DDL).
- `src/lib/door.ts` — device bearer auth, HMAC manifest signing, and the
  manifest builder reading the LIVE tables (paid `bookings` + free
  `promoter_guests` → `promoter_allocations` → `promoter_nights`).
- `POST /api/door/enroll` — one-time code → device token.
- `POST|GET /api/door/devices` — **gated** provisioning (real `club_staff` auth)
  that mints enrollment codes; the door app itself has no Supabase login.
- `GET /api/door/manifest?venue&date` — signed manifest, device-authed.
- `POST /api/door/sync` — bulk push scans/voids (idempotent on `scan_id`) + pull
  fresh manifest. The client batches both admit and void through this one route
  rather than separate `/scan` + `/void`.

To go live: apply the migration, set `DOOR_MANIFEST_SECRET`, provision a device
via `/api/door/devices` to get a real code, then flip `RepoFactory.useMock` to
`false`.

Tickets & membership are modelled client-side but **not yet emitted** by the
manifest (external tickets have no `club_id`/QR; membership isn't per-night) —
deferred per the plan's §8.

## Still hardening

- Client-side manifest **signature verification** (server signs; client stub).
- Move `DeviceSession` token to **Keychain**; encrypt the local store at rest.
- Overscan is recorded (`admission_scans.billable` + cross-door `used`) but not
  yet surfaced as a distinct sync signal — Phase B billing reads the ledger.
