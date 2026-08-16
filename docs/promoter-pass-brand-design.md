# Promoter-branded Apple Wallet pass

Design for a Settings feature in the promoters app that lets a promoter brand
the Wallet pass their guests receive.

> **Status:** §§1–4, 6, 7 and 9's fallback are built (colours, wordmark, live
> preview, validated on both sides, invite pass reads the theme). §5 (logo
> images) is not — the six `*_url` columns exist and `passImages()` already
> falls back to the house mark when they are empty. §8 was shipped as option
> (a): new passes only, with the caveat stated in the UI.
>
> **The migration in `supabase/migrations/20260817_promoter_pass_themes.sql`
> has not been applied.** Until it is, the screen loads on the house defaults
> and Save fails — reads degrade cleanly, writes do not.

Scope is the guest invite pass only — `/api/promoter-invites/guest/[guestId]/wallet`.
The other four pass routes (membership, bookings, tickets, consumer guest-lists)
are Club Fuoco's own artifacts and stay on the house palette.

---

## 1. The constraint that shapes everything

A `.pkpass` is a signed bundle. The signature comes from a **Pass Type ID
certificate**, which belongs to one Apple Developer team — ours. Today that is
five env vars shared by every pass route:

```
APPLE_PASS_TYPE_ID  APPLE_TEAM_ID  APPLE_WWDR_PEM
APPLE_SIGNER_CERT_PEM  APPLE_SIGNER_KEY_PEM (+ _PASS)
```

A promoter cannot supply their own certificate unless they hold their own Apple
Developer membership *and* hand us the private key. We should never accept a
third party's signing key, and requiring each promoter to buy a $99/yr Apple
membership kills the feature.

**So "brand coded" means: the promoter controls the appearance and copy inside a
pass Club Fuoco signs.** That is the normal model for this — it is how every
white-label ticketing platform works. It is worth being clear about internally,
because it sets a hard limit: the pass will always be *issued by* Club Fuoco at
the certificate level, and Wallet surfaces that in the pass's own "issuer"
metadata. What the guest *sees* can be entirely the promoter's.

## 2. What a promoter can change

| Control in Settings | `pass.json` field | Notes |
|---|---|---|
| Background colour | `backgroundColor` | The dominant surface |
| Accent colour | `labelColor` | Field labels — GUEST, VENUE, DATE |
| — (derived) | `foregroundColor` | Computed, never chosen — see §4 |
| Logo image | `logo.png` / `@2x` / `@3x` | Wordmark, top of the pass |
| — (derived from logo) | `icon.png` / `@2x` / `@3x` | Lock screen + Wallet list |
| Brand name | `organizationName` | Shown on lock-screen notifications |
| Wordmark fallback text | `logoText` | Only used when no logo image is set |

Deliberately **not** promoter-editable:

- **Field structure.** The invite pass exists to get a named guest through a
  door. `primaryFields` stays the guest's name, the barcode stays the invite
  token. A promoter rearranging fields can only make the pass worse at the one
  job it has.
- **The barcode and the terms back-field.** Door behaviour and the
  non-transferable notice are ours.
- **A "issued via Club Fuoco" back-field** (new). Provenance stays on the pass
  even when the front is fully the promoter's.

## 3. Where the theme lives

There are already two promoter identity records, and neither is the right home:

- `promoter_profiles` — every promoter, has `brand_name` + `logo_url`, **no
  colour**. (Measured: 2 rows, both named, **zero with a logo**.)
- `partner_brands` — only brand-owning accounts, has `color`, but that colour is
  deliberately operator-controlled: `/api/offers/me` PATCH explicitly refuses to
  let a promoter change `key` or `color` because they are "part of the brand
  contract". (Measured: 5 rows, 2 with logos.)

Overloading either one breaks a rule that is currently written down. A pass
theme also carries things neither table has any business holding — rendered
image derivatives at fixed pixel sizes, and a moderation status.

```sql
create table if not exists public.promoter_pass_themes (
  user_id      uuid primary key references users(id) on delete cascade,

  -- Chosen by the promoter.
  background   text not null default '#0A0807',
  accent       text not null default '#E8B65B',
  logo_text    text,                       -- only used when no logo image

  -- Written by the server only, never by the client: these are the exact
  -- bitmaps that go inside a bundle we sign.
  logo_1x_url  text, logo_2x_url text, logo_3x_url text,
  icon_1x_url  text, icon_2x_url text, icon_3x_url text,

  status       text not null default 'active'
               check (status in ('active','under_review','blocked')),
  updated_at   timestamptz not null default now()
);

alter table public.promoter_pass_themes enable row level security;
-- Read your own; ALL writes go through the API on the service role, so a
-- promoter can never point a derived image URL at something we did not render.
create policy "own theme read" on public.promoter_pass_themes
  for select using (user_id = auth.uid());
```

Defaults are the current hardcoded Club Fuoco values, so a promoter who never
opens the screen keeps exactly today's pass.

## 4. Legibility is a validation rule, not a suggestion

This pass is read by a bouncer, at night, on someone else's phone, in a hurry. A
promoter who picks charcoal on black has shipped a pass that fails at the door
and they will never notice, because they will only ever see it on a bright
screen indoors.

So the promoter picks **two** colours, not four, and the rest is computed:

- `foregroundColor` — black or white, whichever scores higher contrast against
  `background`. Not a choice; there is only ever one right answer.
- `labelColor` — the accent, **if** it clears **3:1** against the background.
- The value text (`foregroundColor`) must clear **4.5:1**.

Both checks run in two places, for different reasons:

- **In the app, live** — the Save button disables and the preview says which
  pairing is failing. This is the one that changes behaviour; a validation error
  after the fact just teaches people to fight the form.
- **On the server, at write time** — because the app is not a security boundary
  and a hand-rolled request must not be able to store an unreadable theme.

Contrast is WCAG relative luminance. It is ~15 lines and belongs in
`src/lib/wallet/contrast.ts` with unit tests, alongside the existing
`expiry.ts` / `expiry.test.ts` pattern.

## 5. Images: rendered on device, verified on the server

Wallet needs PNGs at exact pixel sizes — icon at 29pt square (29/58/87 px) and
logo at max 160×50pt (160×50 / 320×100 / 480×150 px). Promoter logos are
arbitrary sizes; Rumba's is a wide wordmark, and the You tab already had to be
fixed once to stop cropping wordmarks into circles.

**Resize on device, verify on the server.** The app renders the six exact
bitmaps with `UIGraphicsImageRenderer` and uploads them.

- No new server dependency. There is no image library in this project today
  (`sharp` is not a dependency), and adding a native one to a Vercel function to
  do work the phone can already do is a poor trade.
- The preview is honest by construction: the app previews the *same bitmap* it
  uploads, so what the promoter approves is what the guest gets.
- The app already has this muscle — `CreateGuestlistModel.downscaledJPEG`.

The server must still verify, because these bytes end up in a bundle we sign:

- PNG magic number, then parse width/height straight out of the IHDR chunk
  (bytes 16–24). No decoder needed — the existing portal logo route already
  sniffs PNG this way rather than trusting the client's content type.
- Dimensions must equal the expected size for that slot, exactly.
- Hard byte cap per file (256 KB is generous for a wordmark).

Stored at `pass-themes/<user_id>/logo@2x.png` etc. in the existing public
`brand` bucket, with the `?v=<timestamp>` cache-buster the portal route already
uses so a re-upload is not masked by the CDN.

## 6. API

```
GET   /api/promoter/pass-theme     → the caller's theme, or defaults
PATCH /api/promoter/pass-theme     → { background?, accent?, logo_text? }
POST  /api/promoter/pass-theme/images   → multipart, the six rendered PNGs
DELETE /api/promoter/pass-theme/images  → back to the Club Fuoco mark
```

Auth mirrors `/api/offers/me`: caller-scoped, no id in the path, so a promoter
can only ever address their own theme.

`PATCH` returns the derived `foregroundColor` and the two contrast ratios, so
the app renders exactly what the pass will use rather than recomputing it and
risking a drift between the preview and the artifact.

Then the invite route reads the theme of the promoter who owns the night and
substitutes the four hardcoded colour lines plus the image reads. Everything
else in that route is unchanged.

## 7. The Settings screen

`PromoterSettingsView` currently has: account · preferences · payment · support ·
about · danger. Add a **Brand** section above `preferences`, one row —
"Wallet pass" — pushing a detail screen:

1. **Live pass preview, pinned at the top.** A SwiftUI rendering of the
   eventTicket layout with real sample data ("ALEX MORENO", the promoter's next
   real night if they have one). This is the whole point of the screen: nobody
   can reason about a colour pair in the abstract.
2. **Background** and **Accent** — `ColorPicker`, plus 4–5 curated presets that
   are known-good pairings, because most promoters want "black and gold, but
   mine" and should not have to solve a contrast problem to get it.
3. **Logo** — `PhotosPicker`, same flow as the You tab, with a wide preview
   frame (not circular — that bug is already fixed once in this app).
4. **A contrast warning inline**, naming the failing pair, with Save disabled.
5. **Reset to Club Fuoco.**

## 8. The gap you should decide on now

**Passes already in a guest's Wallet will not re-brand.** Measured:
`wallet_pass_registrations` is **empty**, and the invite pass emits no
`webServiceURL` / `authenticationToken` — so every invite pass ever issued is
static. Wallet has no way to fetch an update for it.

Two options:

- **(a) New passes only.** Zero work. A promoter who re-brands sees it on their
  next night. Given 23 nights and 226 guests to date, the blast radius is small.
- **(b) Make invite passes updatable.** Add `webServiceURL` +
  `authenticationToken` to the invite pass and push on theme change. The
  endpoints already exist under `/api/wallet/v1/…` and `pushWalletUpdate()` is
  already written — it is currently only wired for `membership-<userId>`
  serials, so this is mostly generalising a serial prefix.

**Recommendation: ship (a), and say so in the UI** — one line under Save:
"Applies to passes issued from now on." Then do (b) as a follow-on, because it
also earns you the ability to update a pass when a night's *time or venue*
changes, which is a bigger win than re-branding and is currently impossible.

## 9. Moderation

A promoter-supplied logo goes into a bundle signed with our certificate and
appears on a lock screen. Offers already pass through a review queue
(`/api/offers/pending`), so the precedent exists.

Guestlists are time-sensitive, so blocking on review would break the product.
**Recommendation:** themes go live immediately, `status` flips to `under_review`
on any image change, and a blocked theme silently falls back to the Club Fuoco
default rather than failing pass generation. That keeps the door working no
matter what a review decides.

## 10. Suggested build order

1. Migration + contrast lib + tests (no UI, nothing user-visible)
2. `GET`/`PATCH` theme, colours only — the invite route reads it
3. Settings screen with preview and colour pickers — **shippable here**
4. Image upload: device rendering, server verification, invite route reads it
5. Moderation status + fallback
6. (b) from §8: updatable invite passes

Steps 1–3 are a complete feature on their own. Colour is most of the perceived
branding, and it carries none of the image-pipeline risk.
