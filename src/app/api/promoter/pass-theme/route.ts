import { NextRequest } from 'next/server'
import { resolvePromoterCaller } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import { checkThemeHex, checkLogoColor, parseHex, toHex, toPassColor } from '@/lib/wallet/contrast'
import { passThemeRow, HOUSE_THEME, type PassThemeRow } from '@/lib/wallet/pass-theme'

// The Apple Wallet pass branding a promoter applies to the pass their guests
// receive. Caller-scoped like /api/offers/me — there is no id in the path, so
// a promoter can only ever address their own theme.
//
// The response carries the DERIVED values (foreground colour, both contrast
// ratios) rather than leaving the app to recompute them. The app previews what
// the pass will actually use, so preview and artifact cannot drift apart.

function shape(row: PassThemeRow) {
  const check = checkThemeHex(row.background, row.accent)
  return {
    background: row.background,
    accent: row.accent,
    logo_text: row.logo_text,
    logo_mode: row.logo_mode,
    logo_font: row.logo_font,
    logo_color: row.logo_color,
    logo_url: row.logo_2x_url,          // what the app shows in the picker
    has_logo: !!row.logo_1x_url,
    status: row.status,
    derived: {
      foreground: toHex(check.foreground),
      foreground_pass: toPassColor(check.foreground),
      value_ratio: Number(check.valueRatio.toFixed(2)),
      label_ratio: Number(check.labelRatio.toFixed(2)),
      legible: check.ok,
      problems: check.problems,
    },
  }
}

// GET — the caller's theme, or the house defaults when they have never saved
// one. Defaults are not an empty state: they are the pass their guests get
// today, so the screen opens on something real.
export async function GET() {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const row = await passThemeRow(caller.sb, caller.userId)
  return ok({ theme: shape(row) })
}

// PATCH — { background?, accent?, logo_text? }
//
// Validation is not a formality here. A promoter who saves charcoal on black
// ships a pass that fails at a dark door and will never notice, because they
// only ever see it on a bright screen indoors. The app blocks Save on the same
// rule, but the app is not a security boundary, so the check that counts is
// this one.
export async function PATCH(request: NextRequest) {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { userId, sb } = caller

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Bad request')

  const current = await passThemeRow(sb, userId)
  const patch: Partial<PassThemeRow> = {}

  if ('background' in body) {
    if (typeof body.background !== 'string') return err('background must be a hex colour')
    patch.background = body.background.trim().toUpperCase()
  }
  if ('accent' in body) {
    if (typeof body.accent !== 'string') return err('accent must be a hex colour')
    patch.accent = body.accent.trim().toUpperCase()
  }
  if ('logo_text' in body) {
    const t = body.logo_text
    if (t !== null && typeof t !== 'string') return err('logo_text must be a string or null')
    const trimmed = typeof t === 'string' ? t.trim() : null
    if (trimmed && trimmed.length > 24) {
      // PassKit renders logoText on one line beside the logo; a long string is
      // silently truncated on-device, which looks like a bug rather than a limit.
      return err('Wordmark text is too long (max 24 characters)')
    }
    patch.logo_text = trimmed || null
  }
  if ('logo_mode' in body) {
    if (!['none', 'text', 'image'].includes(body.logo_mode)) {
      return err('logo_mode must be none, text or image')
    }
    patch.logo_mode = body.logo_mode
  }
  if ('logo_font' in body) {
    const f = body.logo_font
    if (f !== null && typeof f !== 'string') return err('logo_font must be a string or null')
    // Stored as an opaque PostScript name: the app maps it back through its own
    // fixed list, so an unknown value degrades to the default face rather than
    // rendering a missing glyph. Length-capped only.
    patch.logo_font = (typeof f === 'string' ? f.trim().slice(0, 64) : null) || null
  }
  if ('logo_color' in body) {
    const c = body.logo_color
    if (c !== null && typeof c !== 'string') return err('logo_color must be a string or null')
    patch.logo_color = typeof c === 'string' && c.trim() ? c.trim().toUpperCase() : null
  }

  if (!Object.keys(patch).length) return ok({ unchanged: true, theme: shape(current) })

  const next: PassThemeRow = { ...current, ...patch }
  const check = checkThemeHex(next.background, next.accent)
  if (!check.ok) return err(check.problems.join(' '), 422)

  // A typeset wordmark is drawn on the pass background, so its colour is held
  // to the same standard as everything else that has to be readable there.
  if (next.logo_color) {
    const bg = parseHex(next.background)
    const logo = parseHex(next.logo_color)
    if (!bg || !logo) return err('logo_color must be a hex colour like #E8B65B')
    const logoCheck = checkLogoColor(bg, logo)
    if (!logoCheck.ok) return err(logoCheck.problem!, 422)
  }

  const { error } = await sb
    .from('promoter_pass_themes')
    .upsert({ user_id: userId, ...next }, { onConflict: 'user_id' })
  if (error) return err(error.message, 500)

  return ok({ updated: true, theme: shape(next) })
}

// DELETE — back to the house look. Drops the row rather than rewriting it to
// the defaults, so "never customised" and "reset" stay the same state.
export async function DELETE() {
  const caller = await resolvePromoterCaller()
  if (caller.response) return caller.response
  const { error } = await caller.sb
    .from('promoter_pass_themes')
    .delete()
    .eq('user_id', caller.userId)
  if (error) return err(error.message, 500)
  return ok({ reset: true, theme: shape(HOUSE_THEME) })
}
