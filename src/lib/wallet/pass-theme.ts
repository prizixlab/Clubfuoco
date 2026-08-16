import { createServiceClient } from '@/lib/supabase/server'
import { checkThemeHex, parseHex, toPassColor, CREAM, INK } from './contrast'
import path from 'path'
import fs from 'fs'

// Resolving a promoter's Wallet pass branding into the exact values that go
// into pass.json and the bundle.
//
// The house defaults below are the values that were hardcoded in
// /api/promoter-invites/guest/[guestId]/wallet before themes existed, so a
// promoter with no theme row renders precisely the pass we shipped before.

type SB = Awaited<ReturnType<typeof createServiceClient>>

export const HOUSE_BACKGROUND = '#0A0807'
export const HOUSE_ACCENT     = '#E8B65B'

export type LogoMode = 'none' | 'text' | 'image'

export type PassThemeRow = {
  background: string
  accent: string
  logo_text: string | null
  logo_mode: LogoMode
  logo_font: string | null
  logo_color: string | null
  logo_1x_url: string | null
  logo_2x_url: string | null
  logo_3x_url: string | null
  icon_1x_url: string | null
  icon_2x_url: string | null
  icon_3x_url: string | null
  status: 'active' | 'under_review' | 'blocked'
}

export const HOUSE_THEME: PassThemeRow = {
  background: HOUSE_BACKGROUND,
  accent: HOUSE_ACCENT,
  logo_text: null,
  logo_mode: 'none',
  logo_font: null,
  logo_color: null,
  logo_1x_url: null, logo_2x_url: null, logo_3x_url: null,
  icon_1x_url: null, icon_2x_url: null, icon_3x_url: null,
  status: 'active',
}

const THEME_COLUMNS =
  'background, accent, logo_text, logo_mode, logo_font, logo_color, ' +
  'logo_1x_url, logo_2x_url, logo_3x_url, icon_1x_url, icon_2x_url, icon_3x_url, status'

/** Pass-ready colours: `rgb(r, g, b)` strings, foreground already derived. */
export type ResolvedPassTheme = {
  backgroundColor: string
  labelColor: string
  foregroundColor: string
  /** Only set when the promoter has no logo image — PassKit renders it as text. */
  logoText: string | null
  /** true when this is the house look, i.e. nothing was customised. */
  isHouse: boolean
}

/**
 * Read a promoter's stored theme. Missing row → house theme, which is the
 * common case and not an error.
 */
export async function passThemeRow(sb: SB, promoterId: string): Promise<PassThemeRow> {
  const { data } = await sb
    .from('promoter_pass_themes')
    .select(THEME_COLUMNS)
    .eq('user_id', promoterId)
    .maybeSingle()
  return (data as PassThemeRow | null) ?? HOUSE_THEME
}

/**
 * Turn a stored theme into pass.json colours.
 *
 * Falls back to the house look — rather than failing — for a blocked theme or
 * a colour pair that no longer validates. A pass that cannot be generated is a
 * guest stuck at a door, which is always worse than a pass in the wrong
 * colours. Storage is validated on write; this is the second line.
 */
export function resolvePassTheme(row: PassThemeRow): ResolvedPassTheme {
  const usable =
    row.status !== 'blocked' && checkThemeHex(row.background, row.accent).ok
  const theme = usable ? row : HOUSE_THEME

  const check = checkThemeHex(theme.background, theme.accent)
  const bg = check.backgroundRgb ?? parseHex(HOUSE_BACKGROUND)!
  const accent = check.accentRgb ?? parseHex(HOUSE_ACCENT)!

  return {
    backgroundColor: toPassColor(bg),
    labelColor: toPassColor(accent),
    foregroundColor: toPassColor(check.ok ? check.foreground : CREAM),
    // A wordmark image wins over wordmark text; PassKit shows both if given
    // both, which reads as a mistake.
    logoText: theme.logo_1x_url ? null : (theme.logo_text?.trim() || null),
    // By VALUE, not by identity: a stored row that happens to hold the house
    // colours and nothing else is a house pass, and should still get the
    // flame. Only an actual customisation drops it.
    isHouse: !usable || (
      theme.background.toUpperCase() === HOUSE_BACKGROUND &&
      theme.accent.toUpperCase() === HOUSE_ACCENT &&
      !theme.logo_text?.trim() &&
      !theme.logo_1x_url
    ),
  }
}

const HOUSE_ASSETS = path.join(process.cwd(), 'public', 'pass-assets')

/** The bundle's image files, keyed as PassKit expects them. */
export type PassImages = Record<string, Buffer>

/** icon.png is REQUIRED by PassKit — a bundle without it will not install. */
function houseIcons(): PassImages {
  return {
    'icon.png':    fs.readFileSync(path.join(HOUSE_ASSETS, 'icon.png')),
    'icon@2x.png': fs.readFileSync(path.join(HOUSE_ASSETS, 'icon@2x.png')),
    'icon@3x.png': fs.readFileSync(path.join(HOUSE_ASSETS, 'icon@3x.png')),
  }
}

/** logo.png is optional — omit it and PassKit renders logoText alone. */
function houseLogo(): PassImages {
  return {
    'logo.png':    fs.readFileSync(path.join(HOUSE_ASSETS, 'logo.png')),
    'logo@2x.png': fs.readFileSync(path.join(HOUSE_ASSETS, 'logo@2x.png')),
  }
}

/**
 * The bundle's images for a theme.
 *
 * The house flame goes on a HOUSE pass and nowhere else. On a promoter's pass
 * it sat next to their own wordmark, which read as Club Fuoco co-signing their
 * night rather than as their brand — so a themed pass with no uploaded logo
 * ships no logo image at all, and PassKit draws the wordmark on its own.
 * Provenance still lives on the back of the pass, where it belongs.
 *
 * Promoter logo slots are all-or-nothing: a bundle carrying their logo at @2x
 * but the house mark at @1x would render differently by device. A fetch failure
 * drops to no logo rather than to the house mark, for the same reason — this
 * runs while a guest waits for a download, so it must not fail, but it also
 * must not silently re-brand their pass as ours.
 */
export async function passImages(
  row: PassThemeRow,
  opts: { isHouse: boolean }
): Promise<PassImages> {
  const icons = houseIcons()
  if (row.status === 'blocked' || opts.isHouse) return { ...icons, ...houseLogo() }

  const slots: [keyof PassThemeRow, string][] = [
    ['logo_1x_url', 'logo.png'],
    ['logo_2x_url', 'logo@2x.png'],
    ['logo_3x_url', 'logo@3x.png'],
  ]
  // Themed, but no logo uploaded yet: wordmark only.
  if (slots.some(([key]) => !row[key])) return icons

  try {
    const entries = await Promise.all(
      slots.map(async ([key, file]) => {
        const res = await fetch(row[key] as string, { cache: 'no-store' })
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
        return [file, Buffer.from(await res.arrayBuffer())] as const
      })
    )
    return { ...icons, ...Object.fromEntries(entries) }
  } catch (e) {
    console.warn('[pass-theme] promoter logo unavailable, shipping wordmark only:', e)
    return icons
  }
}

/**
 * The name a promoter's guests know them by.
 *
 * Same precedence the promoter app's You tab uses: a public brand is the
 * consumer-facing identity when the account owns one, otherwise the private
 * profile's brand name. Falls back to the house name so `organizationName` is
 * never blank — PassKit requires it.
 */
export async function promoterDisplayName(sb: SB, promoterId: string): Promise<string> {
  const { data: brand } = await sb
    .from('partner_brands')
    .select('name')
    .eq('owner_user_id', promoterId)
    .maybeSingle()
  const brandName = (brand as { name?: string } | null)?.name?.trim()
  if (brandName) return brandName

  const { data: profile } = await sb
    .from('promoter_profiles')
    .select('brand_name')
    .eq('user_id', promoterId)
    .maybeSingle()
  return (profile as { brand_name?: string } | null)?.brand_name?.trim() || 'Club Fuoco'
}

/** Which promoter's branding a guest's pass should carry. */
export async function promoterForGuest(sb: SB, guestId: string): Promise<string | null> {
  const { data } = await sb
    .from('promoter_guests')
    .select('allocation:promoter_allocations ( promoter_id )')
    .eq('id', guestId)
    .maybeSingle()
  const allocation = (data as { allocation?: unknown } | null)?.allocation
  const row = Array.isArray(allocation) ? allocation[0] : allocation
  return (row as { promoter_id?: string } | undefined)?.promoter_id ?? null
}

export { INK, CREAM }
