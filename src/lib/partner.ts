import type { createServiceClient } from '@/lib/supabase/server'
import { parseValidDays, weekdayOf } from '@/lib/valid-days'

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
  // Specific dates this offer is NOT running, even though valid_days covers
  // them. Clients must treat it as unavailable on these dates.
  skipped_dates?: string[]
  // Paid front-screen promotion: clients pin a featured offer into the hero
  // tier. Optional/drift-defensive — a missing column reads as not featured.
  featured?: boolean
  // Max tickets the offer issues per night; null/absent = no limit. Enforced
  // server-side at join time; clients may show "spots left".
  capacity?: number | null
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
    // Drift-defensive: the column ships in a manual migration, so treat a
    // missing value as "no nights skipped" rather than breaking the feed.
    skipped_dates: (r.skipped_dates as string[] | null) ?? [],
    featured:      r.featured === true,
    capacity:      r.capacity == null ? null : Number(r.capacity),
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

/// The single brand old clients fall back to when they can't read per-offer
/// branding. Everything current attributes per offer, so this is a legacy
/// courtesy, not a gate — see getPartnerOffersByClub.
///
/// Tolerates SEVERAL featured brands. It used to be .maybeSingle(), which
/// errors on more than one row and would have blanked the brand for old
/// clients the moment a second was featured. A hidden supplier is skipped —
/// pointing legacy clients at a brand whose offers are muted is the one
/// genuinely wrong answer — and the rest are ordered by key so the choice is
/// stable between requests rather than whatever Postgres returns first.
export async function getActiveBrand(sb: SB): Promise<(PartnerBrand & { id: string }) | null> {
  const { data } = await sb
    .from('partner_brands')
    .select('*')
    .eq('is_active', true)
  const rows = (data ?? []) as Record<string, unknown>[]
  const usable = rows.filter(r => r.offers_hidden !== true)
  const pick = (usable.length ? usable : rows)
    .sort((a, b) => String(a.key ?? '').localeCompare(String(b.key ?? '')))[0]
  return pick ? toBrand(pick) : null
}

/// Every brand keyed by id, so offers can be attributed without an N+1 lookup,
/// plus the set of suppliers whose offers are currently hidden.
///
/// `hidden` is the portal's supplier-level kill switch (partner_brands
/// .offers_hidden) — NOT is_active, which marks the primary/featured supplier
/// and is deliberately false for auto-provisioned promoter brands whose offers
/// must still show. Reading it via select('*') keeps this working before the
/// migration is applied: a missing column reads as "not hidden".
/**
 * Per-venue rule for which suppliers may show offers there
 * (club_offer_visibility). A venue with no rule shows everyone, so adding a
 * supplier never silently blanks a venue and a missing table (pre-migration)
 * behaves exactly as before.
 */
export interface ClubVisibility { mode: 'all' | 'none' | 'selected'; brand_ids: string[] }

/// Rules are per venue AND per offer kind: a venue can run Rumba's VIP tables
/// and Aashi's guestlist at the same time, which one rule for the whole venue
/// could not express.
///
/// ANY_KIND is the venue-wide fallback. Rules written before the per-kind
/// migration carry it, and a row for a specific kind wins over it — so the old
/// rules keep working untouched and only the kinds you actually split need a
/// decision.
export const ANY_KIND = '*'
export const ANY_DAY  = '*'   // weekday wildcard — a rule that applies every night

export type VisibilityRules = Map<string, ClubVisibility>

// Keyed club|kind|weekday. weekday is '*' (all nights) or '0'..'6' (Sun..Sat,
// matching valid-days.weekdayOf).
const ruleKey = (clubId: string, kind: string, weekday: string) => `${clubId}|${kind}|${weekday}`

// Most specific rule wins, in this order:
//   (kind, day) → (kind, all-days) → (any-kind, day) → (any-kind, all-days)
// Kind is the primary axis (a deliberate per-product choice); day is secondary,
// so a day-specific rule on a kind overrides that kind's all-nights rule.
function ruleFor(
  rules: VisibilityRules, clubId: string, kind: string, weekday: number | null,
): ClubVisibility | undefined {
  const w = weekday === null ? null : String(weekday)
  if (w !== null) { const r = rules.get(ruleKey(clubId, kind, w)); if (r) return r }
  const kAny = rules.get(ruleKey(clubId, kind, ANY_DAY)); if (kAny) return kAny
  if (w !== null) { const r = rules.get(ruleKey(clubId, ANY_KIND, w)); if (r) return r }
  return rules.get(ruleKey(clubId, ANY_KIND, ANY_DAY))
}

function ruleAllows(rule: ClubVisibility | undefined, brandId: string): boolean {
  if (!rule || rule.mode === 'all') return true
  if (rule.mode === 'none') return false
  return rule.brand_ids.includes(brandId)
}

function allowsBrand(
  rules: VisibilityRules, clubId: string, kind: string, brandId: string, weekday: number | null,
): boolean {
  return ruleAllows(ruleFor(rules, clubId, kind, weekday), brandId)
}

// The weekdays (0=Sun..6=Sat) a brand may show for one club+kind.
function allowedWeekdays(rules: VisibilityRules, clubId: string, kind: string, brandId: string): Set<number> {
  const out = new Set<number>()
  for (let w = 0; w < 7; w++) if (allowsBrand(rules, clubId, kind, brandId, w)) out.add(w)
  return out
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function serializeDays(days: Set<number>): string {
  return [0, 1, 2, 3, 4, 5, 6].filter(d => days.has(d)).map(d => DAY_ABBR[d]).join(', ')
}

// Narrow an offer's valid_days to the nights a day-aware conflict rule permits.
// Returns the valid_days string to use — unchanged when the brand is allowed
// every night (so formatting like "Thu – Sun" survives), narrowed when some
// nights are blocked, or null when the brand is blocked on every night the
// offer runs (the caller drops the offer, exactly as an all-days block did).
function narrowValidDays(
  rules: VisibilityRules, clubId: string, kind: string, brandId: string, validDays: string,
): string | null {
  const allowed = allowedWeekdays(rules, clubId, kind, brandId)
  if (allowed.size === 7) return validDays
  if (allowed.size === 0) return null
  const eff = [...parseValidDays(validDays)].filter(d => allowed.has(d))
  return eff.length ? serializeDays(new Set(eff)) : null
}

function toVisibility(r: Record<string, unknown>): ClubVisibility {
  const mode = r.mode === 'none' || r.mode === 'selected' ? r.mode : 'all'
  return { mode, brand_ids: ((r.brand_ids as string[] | null) ?? []).map(String) }
}

function loadRules(rows: Record<string, unknown>[]): VisibilityRules {
  const map: VisibilityRules = new Map()
  for (const row of rows) {
    // Missing kind/weekday columns (pre-migration) read as the wildcards, so
    // every existing rule simply stays venue-wide / all-nights.
    const kind = typeof row.kind === 'string' && row.kind ? row.kind : ANY_KIND
    const weekday = typeof row.weekday === 'string' && row.weekday ? row.weekday : ANY_DAY
    map.set(ruleKey(String(row.club_id), kind, weekday), toVisibility(row))
  }
  return map
}

/// Every rule, keyed club|kind|weekday. Empty map when the table isn't applied.
async function visibilityByClub(sb: SB): Promise<VisibilityRules> {
  try {
    const { data, error } = await sb.from('club_offer_visibility').select('*')
    if (error) return new Map()
    return loadRules((data ?? []) as Record<string, unknown>[])
  } catch { return new Map() }
}

/** One venue's rules. Empty map means "all". */
async function visibilityForClub(sb: SB, clubId: string): Promise<VisibilityRules> {
  try {
    const { data, error } = await sb.from('club_offer_visibility').select('*').eq('club_id', clubId)
    if (error) return new Map()
    return loadRules((data ?? []) as Record<string, unknown>[])
  } catch { return new Map() }
}

async function brandsById(sb: SB): Promise<{
  brands: Map<string, PartnerBrand & { id: string }>
  hidden: Set<string>
}> {
  const { data } = await sb.from('partner_brands').select('*')
  const brands = new Map<string, PartnerBrand & { id: string }>()
  const hidden = new Set<string>()
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>
    const b = toBrand(row)
    brands.set(b.id, b)
    if (row.offers_hidden === true) hidden.add(b.id)
  }
  return { brands, hidden }
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
  const { brands, hidden } = await brandsById(sb)
  const rules = await visibilityByClub(sb)
  const { data } = await sb
    .from('partner_offers')
    .select('*')
    .order('club_id', { ascending: true })
    .order('sort_order', { ascending: true })
  const map: Record<string, PartnerOffer[]> = {}
  for (const r of data ?? []) {
    if (!isActiveOffer(r)) continue
    const row = r as Record<string, unknown> & { club_id: string; brand_id: string }
    // Supplier hidden by the portal — the rows stay untouched, they just
    // don't surface. A club whose ONLY offers come from a hidden supplier
    // drops out of the map entirely, so the feed re-tiers it as no-deal.
    if (hidden.has(row.brand_id)) continue
    // Operator's per-venue, per-kind, per-DAY supplier choice: narrow the
    // offer's nights to those the rule permits (null = blocked every night).
    // The clients already filter by valid_days, so per-day conflicts take
    // effect with no client change.
    const nv = narrowValidDays(rules, row.club_id, String(row.kind ?? ''), row.brand_id, String(row.valid_days ?? ''))
    if (nv === null) continue
    const offer = toOffer(row, brands.get(row.brand_id))
    offer.valid_days = nv
    ;(map[row.club_id] ??= []).push(offer)
  }
  return map
}

// Every live offer for one club, across all brands.
export async function getPartnerOffers(sb: SB, clubId: string | null | undefined): Promise<PartnerOffer[]> {
  if (!clubId) return []
  const { brands, hidden } = await brandsById(sb)
  const rule = await visibilityForClub(sb, clubId)
  const { data } = await sb
    .from('partner_offers')
    .select('*')
    .eq('club_id', clubId)
    .order('sort_order', { ascending: true })
  return (data ?? [])
    .filter(isActiveOffer)
    .filter(r => !hidden.has((r as unknown as { brand_id: string }).brand_id))
    .flatMap(r => {
      const row = r as Record<string, unknown> & { brand_id: string; kind?: string; valid_days?: string }
      const nv = narrowValidDays(rule, clubId, String(row.kind ?? ''), row.brand_id, String(row.valid_days ?? ''))
      if (nv === null) return []
      const offer = toOffer(row, brands.get(row.brand_id))
      offer.valid_days = nv
      return [offer]
    })
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
  // Operator kill switch: every offer from this supplier is hidden from the
  // public feed and refused by the booking gate, without touching the rows.
  // Distinct from is_active, which marks the primary/featured supplier.
  offers_hidden: boolean
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
    // Missing column (pre-migration) reads as "not hidden", so the portal
    // renders correctly before the SQL is applied.
    offers_hidden: (r as { offers_hidden?: boolean }).offers_hidden === true,
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
    offers_hidden: (data as { offers_hidden?: boolean }).offers_hidden === true,
    login_email: ((data as { login_email?: string | null }).login_email) ?? null,
    login_provisioned: !!(data as { owner_user_id?: string | null }).owner_user_id,
  }
}

// Resolve the brand a supplier account owns (owner_user_id = their auth uid).
// Used by the Bearer-authed /api/offers/** routes. Returns the raw row (incl.
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
  return { ...toBrand(data), is_active: false, created_at: (data as { created_at: string }).created_at, offer_count: 0, offers_hidden: false, login_email: null, login_provisioned: false }
}

// `key` is deliberately not updatable — it's the stable slug / storage path.
export async function updateBrand(
  sb: SB,
  id: string,
  patch: Partial<Pick<PartnerBrand, 'name' | 'color' | 'logo_url' | 'attribution_required' | 'attribution_label'>>
    & { login_email?: string | null; offers_hidden?: boolean },
): Promise<void> {
  const { error } = await sb.from('partner_brands').update(patch).eq('id', id)
  if (error) {
    // The hide switch is the one field that can predate its migration.
    if ('offers_hidden' in patch && /offers_hidden/.test(error.message)) {
      throw new Error(
        'Hiding offers needs a schema change that has not been applied yet — run ' +
        'supabase/migrations/20260721_supplier_hide_offers.sql in the SQL editor.')
    }
    throw new Error(error.message)
  }
}

// The switch. Prefer the transactional RPC (20260711_partner_attribution.sql);
// fall back to two sequential updates if the function isn't applied yet —
// unset-then-set never trips the one-active partial-unique index.
/// Feature or unfeature one brand, WITHOUT disturbing the others.
///
/// Deliberately a plain update rather than the set_active_brand RPC, which
/// unsets every other brand — that exclusivity is what we're removing.
///
/// The unique index that enforced one-featured is dropped by
/// 20260722_multi_featured_brands.sql. Until that has been applied a second
/// feature raises 23505, so fall back to the old unset-then-set. That keeps
/// this correct on both sides of the migration and makes it start allowing
/// several the moment the index goes, with no second deploy.
export async function setBrandFeatured(sb: SB, id: string, featured = true): Promise<void> {
  const { data: target } = await sb.from('partner_brands').select('id').eq('id', id).maybeSingle()
  if (!target) throw new Error('brand not found')

  const { error } = await sb.from('partner_brands').update({ is_active: featured }).eq('id', id)
  if (!error) return
  // 23505 = unique_violation: the one-featured index is still in place.
  if (!featured || error.code !== '23505') throw new Error(error.message)

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

/**
 * Which supplier is providing this club's `kind` offer on `date`?
 *
 * Recorded on the booking so the ticket can brand itself — a booking made
 * through Aashi must not print a Rumba pass. Applies exactly the same gates as
 * the feed: archived offers, hidden suppliers and valid_days are all excluded,
 * so this can only ever name a supplier the guest could actually have booked.
 *
 * Returns null when it CANNOT be certain — no live offer, or more than one
 * supplier serving the same club that night. Guessing between two suppliers
 * would print the wrong brand on someone's ticket, and a neutral Club Fuoco
 * pass is the honest fallback. (Clients that know which offer the guest tapped
 * should send the brand explicitly; this is the server-side best effort.)
 */
export async function supplyingBrandId(
  sb: SB, clubId: string, kind: string, date: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('partner_offers')
    .select('*')
    .eq('club_id', clubId)
    .eq('kind', kind)
  if (error || !data?.length) return null

  const { hidden } = await brandsById(sb)
  const rule = await visibilityForClub(sb, clubId)
  const weekday = weekdayOf(date)
  const ids = new Set(
    (data as Record<string, unknown>[])
      .filter(isActiveOffer)
      .filter(r => !hidden.has(String(r.brand_id ?? '')))
      .filter(r => allowsBrand(rule, clubId, kind, String(r.brand_id ?? ''), weekday))
      .filter(r => {
        if (weekday === null) return true
        const days = parseValidDays(String(r.valid_days ?? ''))
        return days.size === 0 || days.has(weekday)
      })
      .filter(r => !((r.skipped_dates as string[] | null) ?? []).includes(date))
      .map(r => String(r.brand_id ?? ''))
      .filter(Boolean),
  )
  return ids.size === 1 ? [...ids][0] : null
}

/// Is this club's offer of `kind` actually running on `date`? Client filtering
/// is presentation; this is the enforcement the booking routes use, so a stale
/// or hand-rolled client can't claim a night the supplier turned off.
export async function offerRunsOn(
  sb: SB, clubId: string, kind: string, date: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from('partner_offers')
    .select('skipped_dates, brand_id, valid_days')
    .eq('club_id', clubId)
    .eq('kind', kind)
  // Column/table not applied yet, or no such offer — don't block the booking.
  if (error || !data?.length) return true

  // A supplier hidden in the portal is hidden here too. Without this the
  // switch would be cosmetic: the offer would vanish from the feed but a
  // stale client (or a native app that hasn't refreshed) could still book it.
  const { hidden } = await brandsById(sb)
  const rule = await visibilityForClub(sb, clubId)
  const rows = data as { skipped_dates?: string[] | null; brand_id?: string; valid_days?: string | null }[]
  const weekday = weekdayOf(date)   // used by both the visibility gate and valid_days below
  // Both operator gates apply here, not just in the feed: a supplier the
  // operator muted (brand-wide) or deselected (at this venue, on this DAY)
  // must be unbookable, or a client that hasn't refreshed could still put
  // someone on a list we've stopped showing.
  const visible = rows
    .filter(r => !hidden.has(r.brand_id ?? ''))
    .filter(r => allowsBrand(rule, clubId, kind, r.brand_id ?? '', weekday))
  if (!visible.length) return false

  // valid_days is enforced HERE, not only in the clients. It is descriptive
  // free text that nothing used to check, so a "Sun – Fri" offer could be
  // booked on a Saturday: the feed hid it, but the booking still went through.
  //
  // An absent or unparseable value is treated as "no weekday restriction"
  // rather than a refusal — bad data must not block a legitimate booking,
  // which is the same leniency the error path above applies. All 15 live
  // offers parse, so in practice this is the strict path.
  const permitted = weekday === null ? visible : visible.filter(r => {
    const days = parseValidDays(r.valid_days ?? '')
    return days.size === 0 || days.has(weekday)
  })
  if (!permitted.length) return false

  // skipped_dates keeps its original strictness: any matching offer skipped on
  // this date refuses the booking.
  return !permitted.some(r => (r.skipped_dates ?? []).includes(date))
}
