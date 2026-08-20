import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ROSTER_ORDER, getJsonSetting } from '@/lib/app-settings'
import { listBrands, type BrandRow } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/portal/promoters — the unified promoter roster. A promoter and a
// "supplier" are the same thing: a partner_brand owned by a promoter account
// (owner_user_id). This returns one row per promoter, folding together:
//   • their access application (promoter_applications: IG verification, status)
//   • their brand (partner_brands: logo/colour/offers/live), if provisioned
// plus prospective brands seeded before their owner has access (owner_user_id
// null, e.g. a list we're onboarding). Keyed by user_id where one exists;
// owner-less brands stand as their own rows.
export interface PromoterRow {
  // Stable row id — the application id when there is one, else the brand id.
  id: string
  // Identity
  user_id: string | null
  email: string | null
  full_name: string | null
  instagram: string | null
  ig_code: string | null
  ig_verified: boolean
  is_promoter: boolean
  // What we take from their sales, so the roster shows it without a click.
  // Null when they have no payout row yet, which reads as "on the default".
  fee_bps: number | null
  public_fee_bps: number | null
  // Application (null for a brand with no application behind it)
  application_id: string | null
  status: 'pending' | 'approved' | 'rejected' | null
  clubs: string | null
  experience: string | null
  created_at: string | null
  reviewed_at: string | null
  // Brand (null for an approved promoter who hasn't been provisioned a brand)
  brand: BrandRow | null
}

interface AppRow {
  id: string; user_id: string; instagram: string | null; clubs: string | null
  experience: string | null; status: 'pending' | 'approved' | 'rejected'
  ig_code: string | null; ig_verified: boolean; created_at: string; reviewed_at: string | null
}

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const [{ data: apps, error: appErr }, brands] = await Promise.all([
    sb.from('promoter_applications')
      .select('id, user_id, instagram, clubs, experience, status, ig_code, ig_verified, created_at, reviewed_at')
      .order('created_at', { ascending: false })
      .limit(200),
    listBrands(sb),
  ])
  if (appErr) return err(appErr.message, 500)

  const appList = (apps ?? []) as AppRow[]
  const brandByOwner = new Map<string, BrandRow>()
  for (const b of brands) if (b.owner_user_id) brandByOwner.set(b.owner_user_id, b)

  // Join in the account (email/name/is_promoter) for every user we touch.
  const userIds = [...new Set([
    ...appList.map(a => a.user_id),
    ...brands.map(b => b.owner_user_id).filter((v): v is string => !!v),
  ])]
  // Rates for the whole roster in one query rather than one per card.
  const feeByUser: Record<string, { fee: number | null; pub: number | null }> = {}
  {
    const { data: fees } = await sb
      .from('promoter_payout_accounts')
      .select('user_id, platform_fee_bps, platform_fee_public_bps')
    for (const f of (fees ?? []) as {
      user_id: string; platform_fee_bps: number | null; platform_fee_public_bps: number | null
    }[]) {
      feeByUser[f.user_id] = { fee: f.platform_fee_bps, pub: f.platform_fee_public_bps }
    }
  }

  const userById: Record<string, { email: string | null; full_name: string | null; is_promoter: boolean }> = {}
  if (userIds.length) {
    const { data: users } = await sb.from('users').select('id, email, full_name, is_promoter').in('id', userIds)
    for (const u of users ?? []) {
      const r = u as { id: string; email: string | null; full_name: string | null; is_promoter: boolean }
      userById[r.id] = { email: r.email, full_name: r.full_name, is_promoter: r.is_promoter }
    }
  }

  const rows: PromoterRow[] = []
  const claimedBrandIds = new Set<string>()

  // 1) One row per application, with the owner's brand folded in.
  for (const a of appList) {
    const u = userById[a.user_id]
    const brand = brandByOwner.get(a.user_id) ?? null
    if (brand) claimedBrandIds.add(brand.id)
    rows.push({
      id: a.id,
      user_id: a.user_id,
      email: u?.email ?? null,
      full_name: u?.full_name ?? null,
      instagram: a.instagram,
      ig_code: a.ig_code,
      ig_verified: a.ig_verified,
      is_promoter: u?.is_promoter ?? false,
      fee_bps: a.user_id ? feeByUser[a.user_id]?.fee ?? null : null,
      public_fee_bps: a.user_id ? feeByUser[a.user_id]?.pub ?? null : null,
      application_id: a.id,
      status: a.status,
      clubs: a.clubs,
      experience: a.experience,
      created_at: a.created_at,
      reviewed_at: a.reviewed_at,
      brand,
    })
  }

  // 2) Brands with no application behind them — a portal-created list (owner set
  //    but never applied) or a prospective one (no owner yet, e.g. Aashi).
  for (const b of brands) {
    if (claimedBrandIds.has(b.id)) continue
    const u = b.owner_user_id ? userById[b.owner_user_id] : undefined
    rows.push({
      id: b.id,
      user_id: b.owner_user_id,
      email: u?.email ?? null,
      full_name: u?.full_name ?? null,
      instagram: null,
      ig_code: null,
      ig_verified: false,
      is_promoter: u?.is_promoter ?? false,
      fee_bps: b.owner_user_id ? feeByUser[b.owner_user_id]?.fee ?? null : null,
      public_fee_bps: b.owner_user_id ? feeByUser[b.owner_user_id]?.pub ?? null : null,
      application_id: null,
      status: null,
      clubs: null,
      experience: null,
      created_at: b.created_at,
      reviewed_at: null,
      brand: b,
    })
  }

  // Operator-chosen order wins; anything not in it (a promoter onboarded since
  // the order was saved) falls to the end, newest first, rather than vanishing
  // or silently jumping to the top.
  const order = await getJsonSetting<string[]>(sb, ROSTER_ORDER, [])
  const rank = new Map(order.map((id, i) => [id, i]))
  const roster = rows
    .filter(r => r.status !== 'pending')
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? Infinity
      const rb = rank.get(b.id) ?? Infinity
      if (ra !== rb) return ra - rb
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })

  return ok({
    pending: rows.filter(r => r.status === 'pending'),
    roster,
  })
}
