# Build brief: Partner Portal (front-page partner manager)

**For:** Fable 5 (executor) · **Owner:** Yakov · **Repo:** `~/Clubfuoco`

## Goal
A small, protected web portal to manage the guestlist **offer supplier** shown
on the front page — so the operator can switch suppliers on any day (Rumbalist
today, "Aashi" tomorrow) **without a code change or App Store release**. Create a
supplier, upload its logo, set its attribution, enter each venue's offers, and
**Activate** it. The consumer web + iOS app read the active supplier live via
`GET /api/partner`.

## Branding model (IMPORTANT — read first)
**Club Fuoco is permanently the brand.** It owns the surface, the front page,
and the accent (ember — never pink). Suppliers are *offer providers*, not the
face of the app. BUT most supplier contracts require **their brand stay
visible** as a **subordinate credit** (a "Guestlist by …" / "Powered by …" line,
sometimes their logo). This requirement **varies per supplier**, so it must be
data-driven and portal-controlled — not hard-coded.

So the app/web show: Club Fuoco branding dominant everywhere, plus a small
**supplier credit** (only where `attribution_required`) on the offer/booking
sheet — the spot suppliers care about most. This is a *credit*, not the old
dominant pink Rumbalist lockup.

## What already exists (DO NOT rebuild — build on this)
- **Tables** (`supabase/migrations/20260711_partner_config.sql`):
  - `partner_brands(id, key unique, name, logo_url, color, is_active, created_at)`
    — partial-unique index `partner_brands_one_active` enforces **at most one
    active** brand.
    - **NEEDS a follow-up migration** to add attribution columns:
      `attribution_required boolean not null default false` and
      `attribution_label text` (e.g. 'Guestlist by', 'Powered by', 'via').
      Expose both in `GET /api/partner`'s `brand` object.
  - `partner_offers(id, brand_id→partner_brands, club_id→clubs, kind
    ['free_guestlist'|'vip_table'], title, subtitle, price_eur, party_size,
    time_window, valid_days, dress_code, music, sort_order, created_at)`.
  - RLS: public **read**; writes are service-role only.
- **Public read API:** `GET /api/partner` → `{ brand:{key,name,logo_url,color},
  offersByClub:{ [clubId]: Offer[] } }` for the active brand. Uncached.
- **Server lib:** `src/lib/partner.ts` (`getActiveBrand`, `getPartnerOffersByClub`,
  `getPartnerOffers`).
- **Storage:** public bucket `brand` (logos live at e.g. `brand/rumba/logo.png`).
- **Seeded:** brand `rumba` is active with the current 10-club offer set.
- **Consumers already wired:** iOS `RumbalistOffers.refresh(api:)` at launch;
  web `src/contexts/PartnerContext.tsx` (fetches `/api/partner`, fallback to the
  bundled current data).

## Scope of the portal
### Screens
1. **Login** (see Auth).
2. **Brands list** — every brand as a card: name, logo thumb, color swatch,
   offer count, and an **Active** badge on the live one. Actions: **Activate**,
   **Edit**, **New brand**.
3. **Brand editor** — `name`, `key` (slug, immutable after create), **color**
   (hex + swatch picker), **logo upload** (→ `brand` bucket, sets `logo_url`),
   plus **attribution**: `attribution_required` toggle + `attribution_label`
   dropdown/free-text ("Guestlist by" / "Powered by" / "via"). Live preview of
   the **supplier credit** as it will appear on the booking sheet + a sample
   offer card, so the operator can honor a contract's visibility clause exactly.
4. **Offers editor** (within a brand) — grouped by club. Pick a club from the
   `clubs` table (searchable), then add/edit/remove offers. Fields:
   `kind` (Free Guestlist / VIP Table), `title`, `subtitle`, `price_eur`
   (VIP only), `party_size`, `time_window`, `valid_days`, `dress_code`,
   `music`. Drag to reorder (`sort_order`). Bulk "duplicate offers from another
   brand" is a nice-to-have (makes standing up a new partner fast).
5. **Activate / switch** — one click. Transactional: unset the current active,
   set this one (or a Postgres RPC `set_active_brand(brand_id)`), so the
   partial-unique index never conflicts. Confirm dialog: *"Make Aashi the live
   partner? Web updates on next load, the app on next open."*

### Backend routes (all behind portal auth; service-role writes)
- `GET  /api/portal/brands` — list all brands (+ offer counts).
- `POST /api/portal/brands` — create `{key,name,color}`.
- `PATCH /api/portal/brands/[id]` — edit `name/color/logo_url`.
- `POST /api/portal/brands/[id]/activate` — the switch (transactional/RPC).
- `POST /api/portal/brands/[id]/logo` — multipart → `brand` bucket → set `logo_url`.
- `GET  /api/portal/brands/[id]/offers` — list.
- `POST /api/portal/brands/[id]/offers` — create.
- `PATCH/DELETE /api/portal/offers/[offerId]` — edit / remove.
- `GET  /api/portal/clubs` — id + name list for the club picker.
- Reuse `src/lib/partner.ts`; add write helpers there.

## Decisions (LOCKED)
- **Auth: shared-secret gate.** A `/portal` route group in the *same* Next.js
  app, gated by a `PORTAL_PASSWORD` env var checked server-side, setting an
  httpOnly session cookie; `middleware.ts` guards `/portal/**` and
  `/api/portal/**`. No new Supabase accounts (honors the "no admin accounts in
  the consumer app" policy). Add `PORTAL_PASSWORD` to `.env.local` + Vercel.
- **Hosting: same repo, same Vercel deploy.** The `/portal` routes ship with the
  app but are password-gated and `noindex`. No separate infra.

## Guardrails / edge cases
- Enforce ≥1 offer before allowing **Activate** (activating an empty brand
  would blank the front-page partner shelf) — warn, don't hard-block.
- `key` is immutable post-create (it's the stable slug / storage path).
- Validate offer fields: VIP requires `price_eur`; free implies `price_eur=null`.
- Logo: accept png/svg, cap ~1–2 MB, store under `brand/<key>/logo.<ext>`,
  cache-bust `logo_url` on re-upload.
- Never expose the service-role key to the browser — all writes go through the
  server routes.

## Propagation note (so expectations are right)
- **Web:** instant — `PartnerContext` fetches `/api/partner` on mount; a reload
  shows the new partner.
- **iOS:** currently refreshes at **launch** only. RECOMMENDED small add-on:
  also refresh on app-foreground (scenePhase → `.active`) so a switch appears
  without a cold start. (One-line change in `ClubFuocoApp.swift` calling
  `RumbalistOffers.refresh(api:)`.)

## Companion client work (separate from the portal, but required for the model)
The consumer apps must render the **supplier credit** when `attribution_required`.
When the app went first-party, all supplier marks were removed, so this is a
small *re-add* — as a subordinate credit, not the old dominant lockup:
- **iOS** (`RumbalistOfferSheet.swift`): show `attribution_label + name`
  (or the logo) in the operator/footer area when required; read from the
  brand fields in `/api/partner` (currently the app only reads offers, not the
  brand object — add brand to `RumbalistOffers.refresh`). Club Fuoco lockup
  stays dominant.
- **Web** (`RumbalistBookSheet.tsx`): same, driven by `usePartner().brand`.
- Keep Club Fuoco's own UI accent ember; the supplier's color is confined to
  its small credit/logo only.

## Out of scope
Editing clubs/venues, other front-page shelves, promoter/consumer features.
This portal manages **supplier brand + offers + attribution** only (extendable
later).

## Definition of done
Operator can: create "Aashi" → upload logo, set color → add offers for N clubs →
Activate → confirm `GET /api/partner` returns Aashi + its offers, web front page
reflects it on reload, and the iOS app on next open. Rumba can be re-activated
in one click.
