import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// The active guestlist partner's identity, shown to users. Swappable at runtime
// (see supabase/migrations/20260711_partner_config.sql) so a partner switch
// doesn't need a rebuild or App Store release.
//
// Attribution (20260711_partner_attribution.sql): when a supplier's contract
// requires their brand stay visible, `attribution_required` turns on a small
// subordinate credit ("Guestlist by Rumba") on the offer/booking sheet. Club
// Fuoco stays the dominant brand everywhere.
export interface PartnerBrand {
  key:                  string
  name:                 string
  logo_url:             string | null
  color:                string
  attribution_required: boolean
  attribution_label:    string | null
}

// A per-club offer (free guestlist / VIP), denormalized for display. Mirrors the
// old RUMBALIST_OFFERS shape so consumers don't have to change.
export interface PartnerOffer {
  kind:        'free_guestlist' | 'vip_table'
  title:       string
  subtitle:    string
  price_eur:   number | null
  party_size:  number | null
  time_window: string
  valid_days:  string
  dress_code:  string
  music:       string
  // Who supplies this offer. Offers come from MANY brands now (any promoter
  // can publish one), so attribution rides on the offer itself rather than a
  // single app-wide "active brand" — that's what lets the booking flow brand
  // itself per offer.
  brand?:      PartnerBrand & { id: string }
}

// Archived offers (20260711_partner_offer_archive.sql) keep their data but
// leave the front page. Missing column (pre-migration) reads as active, so
// public endpoints never break on drift — same select('*') trick as brands.
const isActiveOffer = (r: Record<string, unknown>) => r.is_active !== false

function toOffer(r: Record<string, unknown>, brand?: PartnerBrand & { id: string }): PartnerOffer {
  return {
    kind:        r.kind as PartnerOffer['kind'],
    title:       r.title as string,
    subtitle:    r.subtitle as string,
    price_eur:   r.price_eur == null ? null : Number(r.price_eur),
    party_size:  r.party_size == null ? null : Number(r.party_size),
    time_window: r.time_window as string,
    valid_days:  r.valid_days as string,
    dress_code:  r.dress_code as string,
    music:       r.music as string,
    ...(brand ? { brand } : {}),
  }
}

// select('*') + explicit mapping, not a column list: production drifts from the
// migration files (SQL-editor applies), so the attribution columns may not
// exist yet. This keeps the public /api/partner up either way.
function toBrand(r: Record<string, unknown>): PartnerBrand & { id: string } {
  return {
    id:                   r.id as string,
    key:                  r.key as string,
    name:                 r.name as string,
    logo_url:             (r.logo_url as string | null) ?? null,
    color:                r.color as string,
    attribution_required: r.attribution_required === true,
    attribution_label:    (r.attribution_label as string | null) ?? null,
  }
}

export async function getActiveBrand(sb: SB): Promise<(PartnerBrand & { id: string }) | null> {
  const { data } = await sb
    .from('partner_brands')
    .select('*')
    .eq('is_active', true)
    .maybeSingle()
  return data ? toBrand(data) : null
}

/// Every brand keyed by id, so offers can be attributed without an N+1 lookup.
async function brandsById(sb: SB): Promise<Map<string, PartnerBrand & { id: string }>> {
  const { data } = await sb.from('partner_brands').select('*')
  const map = new Map<string, PartnerBrand & { id: string }>()
  for (const r of data ?? []) {
    const b = toBrand(r as Record<string, unknown>)
    map.set(b.id, b)
  }
  return map
}

// Every LIVE offer across EVERY brand, grouped by club id, each carrying its
// own brand for attribution.
//
// Visibility is the OFFER's own is_active flag, not its brand's: promoters and
// suppliers are one role, so any promoter can publish an offer, and each one is
// already gated by Club Fuoco review before a live partner_offers row exists.
// Brand.is_active still marks the primary supplier (getActiveBrand) but no
// longer decides what consumers see — gating on it would mean a promoter's
// approved offer passed review and still never appeared.
export async function getPartnerOffersByClub(sb: SB): Promise<Record<string, PartnerOffer[]>> {
  const brands = await brandsById(sb)
  const { data } = await sb
    .from('partner_offers')
    .select('*')
    .order('club_id', { ascending: true })
    .order('sort_order', { ascending: true })
  const map: Record<string, PartnerOffer[]> = {}
  for (const r of data ?? []) {
    if (!isActiveOffer(r)) continue
    const row = r as Record<string, unknown> & { club_id: string; brand_id: string }
    ;(map[row.club_id] ??= []).push(toOffer(row, brands.get(row.brand_id)))
  }
  return map
}

// Every live offer for one club, across all brands.
export async function getPartnerOffers(sb: SB, clubId: string | null | undefined): Promise<PartnerOffer[]> {
  if (!clubId) return []
  const brands = await brandsById(sb)
  const { data } = await sb
    .from('partner_offers')
    .select('*')
    .eq('club_id', clubId)
    .order('sort_order', { ascending: true })
  return (data ?? [])
    .filter(isActiveOffer)
    .map(r => toOffer(r as Record<string, unknown>,
                      brands.get((r as unknown as { brand_id: string }).brand_id)))
}

// ── Portal write helpers ─────────────────────────────────────────────────────
// Used only by /api/portal/** routes (portal-password gated, service client).
// Row shapes are the raw DB rows — the portal is an admin surface and wants
// ids/brand_id/sort_order, unlike the public consumer payload above.

export interface BrandRow extends PartnerBrand {
  id:          string
  is_active:   boolean
  created_at:  string
  offer_count: number
  // The supplier's own login email for the FuocoPromoters app. Operator-only —
  // deliberately NOT part of the consumer-facing PartnerBrand, and the public
  // /api/partner never emits it.
  login_email: string | null
  // true once a promoter account has been provisioned + linked (owner_user_id
  // set) for this brand. The uid itself stays server-side.
  login_provisioned: boolean
}

// offer_count counts ACTIVE offers only — it drives the "activating an empty
// brand blanks the shelf" warning, and archived offers don't fill the shelf.
export async function listBrands(sb: SB): Promise<BrandRow[]> {
  const [{ data: brands, error }, { data: offers }] = await Promise.all([
    sb.from('partner_brands').select('*').order('created_at', { ascending: true }),
    sb.from('partner_offers').select('*'),
  ])
  if (error) throw new Error(error.message)
  const counts: Record<string, number> = {}
  for (const o of offers ?? []) {
    if (!isActiveOffer(o)) continue
    counts[(o as { brand_id: string }).brand_id] = (counts[(o as { brand_id: string }).brand_id] ?? 0) + 1
  }
  return (brands ?? []).map(r => ({
    ...toBrand(r),
    is_active:   (r as { is_active: boolean }).is_active,
    created_at:  (r as { created_at: string }).created_at,
    offer_count: counts[(r as { id: string }).id] ?? 0,
    login_email: ((r as { login_email?: string | null }).login_email) ?? null,
    login_provisioned: !!(r as { owner_user_id?: string | null }).owner_user_id,
  }))
}

export async function getBrand(sb: SB, id: string): Promise<BrandRow | null> {
  const { data } = await sb.from('partner_brands').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const { data: offers } = await sb.from('partner_offers').select('*').eq('brand_id', id)
  return {
    ...toBrand(data),
    is_active:   (data as { is_active: boolean }).is_active,
    created_at:  (data as { created_at: string }).created_at,
    offer_count: (offers ?? []).filter(isActiveOffer).length,
    login_email: ((data as { login_email?: string | null }).login_email) ?? null,
    login_provisioned: !!(data as { owner_user_id?: string | null }).owner_user_id,
  }
}

// Resolve the brand a supplier account owns (owner_user_id = their auth uid).
// Used by the Bearer-authed /api/supplier/** routes. Returns the raw row (incl.
// id) or null if this user isn't linked to a brand.
export async function getBrandByOwner(sb: SB, userId: string): Promise<(PartnerBrand & { id: string }) | null> {
  const { data } = await sb
    .from('partner_brands')
    .select('*')
    .eq('owner_user_id', userId)
    .maybeSingle()
  return data ? toBrand(data) : null
}

export async function createBrand(
  sb: SB,
  input: { key: string; name: string; color: string },
): Promise<BrandRow> {
  const { data, error } = await sb
    .from('partner_brands')
    .insert({ key: input.key, name: input.name, color: input.color, is_active: false })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { ...toBrand(data), is_active: false, created_at: (data as { created_at: string }).created_at, offer_count: 0, login_email: null, login_provisioned: false }
}

// `key` is deliberately not updatable — it's the stable slug / storage path.
export async function updateBrand(
  sb: SB,
  id: string,
  patch: Partial<Pick<PartnerBrand, 'name' | 'color' | 'logo_url' | 'attribution_required' | 'attribution_label'>>
    & { login_email?: string | null },
): Promise<void> {
  const { error } = await sb.from('partner_brands').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// The switch. Prefer the transactional RPC (20260711_partner_attribution.sql);
// fall back to two sequential updates if the function isn't applied yet —
// unset-then-set never trips the one-active partial-unique index.
export async function activateBrand(sb: SB, id: string): Promise<void> {
  const { error } = await sb.rpc('set_active_brand', { brand: id })
  if (!error) return
  const missingFn = error.code === 'PGRST202' || /set_active_brand/.test(error.message)
  if (!missingFn) throw new Error(error.message)

  const { data: target } = await sb.from('partner_brands').select('id').eq('id', id).maybeSingle()
  if (!target) throw new Error('brand not found')
  const off = await sb.from('partner_brands').update({ is_active: false }).eq('is_active', true).neq('id', id)
  if (off.error) throw new Error(off.error.message)
  const on = await sb.from('partner_brands').update({ is_active: true }).eq('id', id)
  if (on.error) throw new Error(on.error.message)
}

export interface OfferRow extends PartnerOffer {
  id:         string
  brand_id:   string
  club_id:    string
  sort_order: number
  is_active:  boolean   // false = archived: data kept, hidden from the front page
}

function toOfferRow(r: Record<string, unknown>): OfferRow {
  return {
    ...toOffer(r),
    id:         r.id as string,
    brand_id:   r.brand_id as string,
    club_id:    r.club_id as string,
    sort_order: Number(r.sort_order ?? 0),
    is_active:  isActiveOffer(r),
  }
}

// Portal view — includes archived offers (the whole point is seeing them).
export async function listBrandOffers(sb: SB, brandId: string): Promise<OfferRow[]> {
  const { data, error } = await sb
    .from('partner_offers')
    .select('*')
    .eq('brand_id', brandId)
    .order('club_id', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toOfferRow)
}

export type OfferInput = PartnerOffer & { club_id: string; sort_order?: number; is_active?: boolean }

export async function createOffer(sb: SB, brandId: string, input: OfferInput): Promise<OfferRow> {
  const { data, error } = await sb
    .from('partner_offers')
    .insert({ ...input, brand_id: brandId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toOfferRow(data)
}

export async function updateOffer(
  sb: SB,
  offerId: string,
  patch: Partial<OfferInput>,
): Promise<void> {
  const { error } = await sb.from('partner_offers').update(patch).eq('id', offerId)
  if (error) throw new Error(error.message)
}

export async function deleteOffer(sb: SB, offerId: string): Promise<void> {
  const { error } = await sb.from('partner_offers').delete().eq('id', offerId)
  if (error) throw new Error(error.message)
}

// Bulk "duplicate offers from another brand" — stands up a new partner fast.
// Copies every offer row (all clubs) from `fromBrandId`, skipping clubs the
// target brand already has offers for.
export async function duplicateOffers(sb: SB, fromBrandId: string, toBrandId: string): Promise<number> {
  const [source, existing] = await Promise.all([
    listBrandOffers(sb, fromBrandId),
    listBrandOffers(sb, toBrandId),
  ])
  const taken = new Set(existing.map(o => o.club_id))
  const rows = source
    .filter(o => !taken.has(o.club_id))
    .map(({ id: _id, brand_id: _b, ...rest }) => ({ ...rest, brand_id: toBrandId }))
  if (!rows.length) return 0
  const { error } = await sb.from('partner_offers').insert(rows)
  if (error) throw new Error(error.message)
  return rows.length
}
