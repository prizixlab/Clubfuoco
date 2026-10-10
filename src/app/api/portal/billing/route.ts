import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err, chunked } from '@/lib/utils'
import { NON_ADMITTING_PAYMENT_LIST } from '@/lib/refunds'

// GET /api/portal/billing?period=YYYY-MM|all
// Every guestlist and purchase made in the app, attributed to the promoter who
// sold it and the club it's for, with the guest behind it — the basis for
// billing promoters. Same three sources as Insights:
//   * bookings          — partner offers / VIP / feed reservations. Promoter =
//                         the booking's brand, else the night's creator.
//   * promoter_guests   — spots on promoter/house events. Promoter = the
//                         allocation's promoter. Twin copies (mirror_of) and
//                         unpaid holds/refunds are skipped; a guest row that
//                         duplicates a booking for the same user+night too.
//   * external_tickets  — Fourvenues lists/tickets/tables bought in the app.
//                         Promoter = the brand selling that event code.
// Assignments (billing_assignments) give an event — a club on a night — a
// promoter, for entries that have none of their own (old offer bookings).
// Exclusions (billing_exclusions) mark people or single entries that don't
// count — they're returned flagged, never dropped, so the operator can see
// and undo them.

type Source = 'offer' | 'event' | 'fourvenues'
type Kind = 'guestlist' | 'ticket' | 'table'

export interface BillingLine {
  id: string
  source: Source
  kind: Kind
  heads: number
  amount: number | null          // EUR
  created_at: string
  night: string | null
  club_id: string | null
  club: string
  promoter_key: string           // brand id, or a synthetic key
  promoter: string
  user_id: string | null
  user_name: string | null
  user_email: string | null
  user_phone: string | null
  checked_in: boolean
  excluded: { id: string; by: 'user' | 'line'; reason: string | null } | null
  /** No promoter of its own — the operator can assign its event (club + night). */
  assignable: boolean
  /** Promoter came from a billing_assignments row, not from the data. */
  assigned: boolean
}

const FUOCO_HOUSE = { key: 'fuoco:house', name: 'Club Fuoco (house)' }
const FUOCO_DIRECT = { key: 'fuoco:direct', name: 'Club Fuoco (no promoter)' }

function periodRange(period: string): { from: string | null; to: string | null } {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return { from: null, to: null }
  const y = Number(m[1]), mo = Number(m[2])
  return {
    from: new Date(Date.UTC(y, mo - 1, 1)).toISOString(),
    to: new Date(Date.UTC(y, mo, 1)).toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const now = new Date()
  const period = new URL(req.url).searchParams.get('period')
    ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const { from, to } = periodRange(period)
  const within = <T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(q: T) =>
    from && to ? q.gte('created_at', from).lt('created_at', to) : q

  // ── Brands (promoters) ────────────────────────────────────────────────────
  const { data: brandRows } = await sb.from('partner_brands').select('id, key, name, owner_user_id')
  const brands = (brandRows ?? []) as { id: string; key: string; name: string; owner_user_id: string | null }[]
  const brandById = new Map(brands.map(b => [b.id, b]))
  const brandByKey = new Map(brands.map(b => [b.key, b]))
  const brandByOwner = new Map(brands.filter(b => b.owner_user_id).map(b => [b.owner_user_id as string, b]))

  // A promoter without a brand row still gets their own bucket, named after
  // their account (filled in once users are loaded).
  const ownerKey = (userId: string | null | undefined) => {
    if (!userId) return FUOCO_DIRECT
    const b = brandByOwner.get(userId)
    return b ? { key: b.id, name: b.name } : { key: `user:${userId}`, name: '' }
  }

  type Raw = Omit<BillingLine, 'club' | 'user_name' | 'user_email' | 'user_phone' | 'excluded' | 'assignable' | 'assigned'>
  const raw: Raw[] = []

  // ── Bookings ──────────────────────────────────────────────────────────────
  const { data: bookings, error } = await within(
    sb.from('bookings').select(
      'id, user_id, club_id, night_id, brand_id, booking_type, party_size, booking_date, status, created_at, total_amount, checked_in_at',
    ),
  )
  if (error) return err(error.message, 500)
  const bk = (bookings ?? []) as {
    id: string; user_id: string | null; club_id: string; night_id: string | null; brand_id: string | null
    booking_type: string; party_size: number | null; booking_date: string | null; status: string
    created_at: string; total_amount: number | null; checked_in_at: string | null
  }[]

  // Nights referenced by bookings (creator → promoter, house flag).
  const nightIds = [...new Set(bk.map(b => b.night_id).filter(Boolean))] as string[]
  const nightInfo = new Map<string, { created_by: string | null; is_house: boolean }>()
  for (const ids of chunked(nightIds, 100)) {
    const { data } = await sb.from('promoter_nights').select('id, created_by, is_house').in('id', ids)
    for (const n of (data ?? []) as { id: string; created_by: string | null; is_house: boolean | null }[]) {
      nightInfo.set(n.id, { created_by: n.created_by, is_house: !!n.is_house })
    }
  }

  const bookedNight = new Set<string>()
  for (const b of bk) {
    if (b.status === 'cancelled') continue
    if (b.night_id && b.user_id) bookedNight.add(`${b.user_id}|${b.night_id}`)
    let promoter = FUOCO_DIRECT
    const brand = b.brand_id ? brandById.get(b.brand_id) : undefined
    if (brand) promoter = { key: brand.id, name: brand.name }
    else if (b.night_id) {
      const n = nightInfo.get(b.night_id)
      promoter = n?.is_house ? FUOCO_HOUSE : ownerKey(n?.created_by)
    }
    const amount = Number(b.total_amount ?? 0)
    raw.push({
      id: b.id, source: b.night_id ? 'event' : 'offer',
      kind: b.booking_type === 'vip' ? 'table' : amount > 0 ? 'ticket' : 'guestlist',
      heads: Math.max(1, b.party_size ?? 1), amount: amount > 0 ? amount : null,
      created_at: b.created_at, night: b.booking_date, club_id: b.club_id,
      promoter_key: promoter.key, promoter: promoter.name,
      user_id: b.user_id, checked_in: !!b.checked_in_at,
    })
  }

  // ── Event spots ───────────────────────────────────────────────────────────
  const { data: guests } = await within(
    sb.from('promoter_guests')
      .select(`id, full_name, claimed_by_user, purchased_by_user, payment_status, amount_cents, plus_ones,
               created_at, checked_in_at, mirror_of,
               allocation:promoter_allocations ( promoter_id, night:promoter_nights ( id, club_id, night_date, is_house, location_name ) )`)
      .or(`payment_status.is.null,payment_status.not.in.${NON_ADMITTING_PAYMENT_LIST}`),
  )
  const guestNames = new Map<string, string>()   // line id → name typed on the list
  for (const g of (guests ?? []) as unknown as {
    id: string; full_name: string | null; claimed_by_user: string | null; purchased_by_user: string | null
    payment_status: string | null; amount_cents: number | null; plus_ones: number | null
    created_at: string; checked_in_at: string | null; mirror_of: string | null
    allocation: {
      promoter_id: string | null
      night: { id: string; club_id: string | null; night_date: string | null; is_house: boolean | null; location_name: string | null } | null
    } | null
  }[]) {
    if (g.mirror_of) continue                       // twin copy of a ticket counted elsewhere
    const night = g.allocation?.night
    if (!night) continue
    const user = g.claimed_by_user ?? g.purchased_by_user
    if (user && bookedNight.has(`${user}|${night.id}`)) continue
    const paid = g.payment_status === 'paid' && (g.amount_cents ?? 0) > 0
    const promoter = night.is_house ? FUOCO_HOUSE : ownerKey(g.allocation?.promoter_id)
    if (g.full_name) guestNames.set(g.id, g.full_name)
    raw.push({
      id: g.id, source: 'event', kind: paid ? 'ticket' : 'guestlist',
      heads: 1 + Math.max(0, g.plus_ones ?? 0), amount: paid ? (g.amount_cents ?? 0) / 100 : null,
      created_at: g.created_at, night: night.night_date, club_id: night.club_id,
      promoter_key: promoter.key, promoter: promoter.name,
      user_id: user, checked_in: !!g.checked_in_at,
    })
    if (!night.club_id && night.location_name) guestNames.set(`loc:${g.id}`, night.location_name)
  }

  // ── Fourvenues ────────────────────────────────────────────────────────────
  const { data: ext } = await within(
    sb.from('external_tickets').select('id, user_id, event_code, venue, club_id, night, settle, unit_price, heads, created_at'),
  )
  const extRows = (ext ?? []) as {
    id: string; user_id: string | null; event_code: string | null; venue: string | null; club_id: string | null
    night: string | null; settle: string; unit_price: number | null; heads: number | null; created_at: string
  }[]
  // Event code → selling brand: the live catalog first, then our own nights
  // that carry a Fourvenues code. Past events drop out of the catalog, so the
  // fallback is HypeList — the only brand selling on our Fourvenues channel.
  const codeBrand = new Map<string, string>()
  if (extRows.length) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fourvenues/offers.json`,
        { cache: 'no-store' },
      )
      const feed = await res.json() as { events?: { code: string; brand?: string }[] }
      for (const e of feed.events ?? []) if (e.brand) codeBrand.set(e.code, e.brand)
    } catch { /* catalog unreachable → fallbacks */ }
    const codes = [...new Set(extRows.map(t => t.event_code).filter(c => c && !codeBrand.has(c)))] as string[]
    if (codes.length) {
      const { data } = await sb.from('promoter_nights').select('fourvenues_code, created_by').in('fourvenues_code', codes)
      for (const n of (data ?? []) as { fourvenues_code: string; created_by: string | null }[]) {
        const b = n.created_by ? brandByOwner.get(n.created_by) : undefined
        if (b) codeBrand.set(n.fourvenues_code, b.key)
      }
    }
  }
  const extVenue = new Map<string, string>()
  for (const t of extRows) {
    const b = brandByKey.get((t.event_code && codeBrand.get(t.event_code)) || 'hypelist')
    const promoter = b ? { key: b.id, name: b.name } : { key: 'fv:unknown', name: 'Fourvenues' }
    const kind: Kind = t.settle === 'table' ? 'table' : t.settle === 'free' ? 'guestlist' : 'ticket'
    const price = Number(t.unit_price ?? 0)
    const heads = Math.max(1, t.heads ?? 1)
    if (!t.club_id && t.venue) extVenue.set(t.id, t.venue)
    raw.push({
      id: t.id, source: 'fourvenues', kind, heads,
      amount: price > 0 ? (kind === 'table' ? price : price * heads) : null,
      created_at: t.created_at, night: t.night, club_id: t.club_id,
      promoter_key: promoter.key, promoter: promoter.name,
      user_id: t.user_id, checked_in: false,
    })
  }

  // ── Names: clubs, users ───────────────────────────────────────────────────
  const clubIds = [...new Set(raw.map(l => l.club_id).filter(Boolean))] as string[]
  const clubName = new Map<string, string>()
  for (const ids of chunked(clubIds, 100)) {
    const { data } = await sb.from('clubs').select('id, name').in('id', ids)
    for (const c of (data ?? []) as { id: string; name: string }[]) clubName.set(c.id, c.name)
  }
  const userIds = new Set(raw.map(l => l.user_id).filter(Boolean) as string[])
  for (const l of raw) if (l.promoter_key.startsWith('user:')) userIds.add(l.promoter_key.slice(5))
  const users = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>()
  for (const ids of chunked([...userIds], 100)) {
    const { data } = await sb.from('users').select('id, full_name, email, phone').in('id', ids)
    for (const u of (data ?? []) as { id: string; full_name: string | null; email: string | null; phone: string | null }[]) {
      users.set(u.id, u)
    }
  }

  // ── Exclusions ────────────────────────────────────────────────────────────
  const ex = await sb.from('billing_exclusions').select('id, user_id, source, line_id, reason')
  const exclusionsReady = !ex.error
  const exUser = new Map<string, { id: string; reason: string | null }>()
  const exLine = new Map<string, { id: string; reason: string | null }>()
  for (const e of (ex.data ?? []) as { id: string; user_id: string | null; source: string | null; line_id: string | null; reason: string | null }[]) {
    if (e.user_id) exUser.set(e.user_id, { id: e.id, reason: e.reason })
    else if (e.line_id) exLine.set(`${e.source}|${e.line_id}`, { id: e.id, reason: e.reason })
  }

  // ── Assignments ───────────────────────────────────────────────────────────
  const as = await sb.from('billing_assignments').select('club_id, night, brand_id')
  const assignmentsReady = !as.error
  const assignedBrand = new Map<string, string>()
  for (const a of (as.data ?? []) as { club_id: string; night: string; brand_id: string }[]) {
    assignedBrand.set(`${a.club_id}|${a.night}`, a.brand_id)
  }

  const lines: BillingLine[] = raw.map(l => {
    const u = l.user_id ? users.get(l.user_id) : undefined
    const assignable = l.promoter_key === FUOCO_DIRECT.key && !!l.club_id && !!l.night
    const brand = assignable ? brandById.get(assignedBrand.get(`${l.club_id}|${l.night}`) ?? '') : undefined
    if (brand) { l.promoter_key = brand.id; l.promoter = brand.name }
    const line = exLine.get(`${l.source}|${l.id}`)
    const person = l.user_id ? exUser.get(l.user_id) : undefined
    return {
      ...l,
      promoter: l.promoter || users.get(l.promoter_key.slice(5))?.full_name || 'Promoter (no brand)',
      club: (l.club_id && clubName.get(l.club_id)) || extVenue.get(l.id) || guestNames.get(`loc:${l.id}`) || '—',
      user_name: u?.full_name ?? guestNames.get(l.id) ?? null,
      user_email: u?.email ?? null,
      user_phone: u?.phone ?? null,
      excluded: line ? { ...line, by: 'line' as const } : person ? { ...person, by: 'user' as const } : null,
      assignable,
      assigned: !!brand,
    }
  }).sort((a, b) => b.created_at.localeCompare(a.created_at))

  // Promoters the operator can assign an event to.
  const promoters = brands
    .map(b => ({ id: b.id, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return ok({ period, exclusionsReady, assignmentsReady, promoters, lines })
}
