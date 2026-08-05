import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { getBrandByOwner, type PartnerBrand } from '@/lib/partner'
import { err } from '@/lib/utils'

type SB = Awaited<ReturnType<typeof createServiceClient>>

/// Brand color for an auto-provisioned promoter brand. Club Fuoco gold —
/// NEVER pink (that's the legacy Rumbalist mark, see the brand rules).
const DEFAULT_BRAND_COLOR = '#C09950'

// Resolve the FuocoPromoters caller (Bearer JWT) to their user id. Writes go
// through the service client, so this check IS the authorization boundary.
async function resolveCaller(): Promise<
  | { userId: string; sb: SB; response?: undefined }
  | { response: Response; userId?: undefined; sb?: undefined }
> {
  let token: string | null = null
  try {
    const h = await headers()
    token = h.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  } catch {
    // headers() unavailable
  }
  if (!token) return { response: err('Unauthorized', 401) }

  const sb = await createServiceClient()
  const { data: userResp } = await sb.auth.getUser(token)
  const user = userResp.user
  if (!user) return { response: err('Unauthorized', 401) }
  return { userId: user.id, sb }
}

// Resolve the caller to the brand they own. Every /api/offers write must
// scope to the returned brand.
//
// Promoters and suppliers are ONE role: a promoter publishes public offers
// under their own brand, which is provisioned lazily the first time they
// create one (`provision: true`). Reads use `brandOrNull` instead — a promoter
// with no public offers yet simply has no brand, which is not an error.
export async function resolveOfferBrand(): Promise<
  | { brand: PartnerBrand & { id: string }; userId: string; sb: SB; response?: undefined }
  | { response: Response; brand?: undefined; userId?: undefined; sb?: undefined }
> {
  const caller = await resolveCaller()
  if (caller.response) return { response: caller.response }
  const { userId, sb } = caller

  const brand = await getBrandByOwner(sb, userId)
  if (!brand) return { response: err('No brand is linked to this account', 403) }
  return { brand, userId, sb }
}

/// Caller + their brand if they have one (null if not). For reads: a promoter
/// who has never published a public offer has no brand, and should get an
/// empty list rather than a 403.
export async function brandOrNull(): Promise<
  | { brand: (PartnerBrand & { id: string }) | null; userId: string; sb: SB; response?: undefined }
  | { response: Response; brand?: undefined; userId?: undefined; sb?: undefined }
> {
  const caller = await resolveCaller()
  if (caller.response) return { response: caller.response }
  const { userId, sb } = caller
  return { brand: await getBrandByOwner(sb, userId), userId, sb }
}

/// Caller + their brand, creating one from their promoter profile if they
/// don't have one yet (first public offer). The new brand is is_active=false
/// on purpose: `getActiveBrand()` does `.eq('is_active', true).maybeSingle()`,
/// so a second active brand would throw and break the consumer offers feed.
/// Activation stays an operator decision.
export async function resolveOrProvisionBrand(): Promise<
  | { brand: PartnerBrand & { id: string }; userId: string; sb: SB; response?: undefined }
  | { response: Response; brand?: undefined; userId?: undefined; sb?: undefined }
> {
  const caller = await resolveCaller()
  if (caller.response) return { response: caller.response }
  const { userId, sb } = caller
  return { brand: await provisionBrandForUser(sb, userId), userId, sb }
}

/// Ensure a given promoter account owns a brand, creating one from their
/// promoter profile (falling back to their account name) if it doesn't exist
/// yet. Idempotent: returns the existing brand when there is one, so it's safe
/// to call on every approval and to re-run for a backfill — and it never
/// violates the one-brand-per-owner unique index. userId-based (not session),
/// so both the FuocoPromoters app (first offer) and the portal (on approval)
/// share the exact same provisioning + key scheme. The new brand is
/// is_active=false: activation stays an operator decision, and a second active
/// brand would break getActiveBrand()'s .maybeSingle().
export async function provisionBrandForUser(
  sb: SB,
  userId: string,
): Promise<PartnerBrand & { id: string }> {
  const existing = await getBrandByOwner(sb, userId)
  if (existing) return existing

  // Name/logo from the promoter's own brand profile, falling back to their
  // account name so the brand is never nameless.
  const { data: profile } = await sb
    .from('promoter_profiles')
    .select('brand_name, logo_url')
    .eq('user_id', userId)
    .maybeSingle()
  const { data: userRow } = await sb
    .from('users')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle()

  const p = profile as { brand_name?: string | null; logo_url?: string | null } | null
  const u = userRow as { full_name?: string | null; email?: string | null } | null
  const name =
    p?.brand_name?.trim() ||
    u?.full_name?.trim() ||
    u?.email?.split('@')[0] ||
    'Promoter'

  const slug = name.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'promoter'
  // Suffix keeps `key` unique (it's the stable slug / storage path).
  const key = `${slug}-${userId.slice(0, 8)}`

  const { data, error } = await sb
    .from('partner_brands')
    .insert({
      key,
      name,
      logo_url: p?.logo_url ?? null,
      color: DEFAULT_BRAND_COLOR,
      is_active: false,
      owner_user_id: userId,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  const row = data as {
    id: string; key: string; name: string; logo_url: string | null; color: string
    attribution_required?: boolean | null; attribution_label?: string | null
  }
  return {
    id:                   row.id,
    key:                  row.key,
    name:                 row.name,
    logo_url:             row.logo_url ?? null,
    color:                row.color,
    attribution_required: row.attribution_required === true,
    attribution_label:    row.attribution_label ?? null,
  }
}
