import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/portal/brands/:id/events — the events this brand's promoter runs.
//
// Events and offers are different things and the brand page shows them apart:
// an OFFER is a standing per-venue product (`partner_offers`, keyed by
// valid_days), an EVENT is one dated night (`promoter_nights`). A promoter can
// have many of one and none of the other.
//
// Ownership goes through the brand's `owner_user_id`, because that is the only
// link there is — promoter_nights has no brand_id, it has `created_by`. A
// brand with no owner yet (a prospective list seeded before its promoter has
// access) therefore has no events rather than an error.
//
// This is the OPERATOR's view, matching /api/portal/events: unpublished,
// unapproved, private and past nights are all included, because seeing what
// exists is the point.
export interface BrandEvent {
  id: string
  title: string | null
  night_date: string
  club_id: string | null
  club_name: string | null
  /** Free-text venue for a night at a custom location (no `clubs` row). */
  location_name: string | null
  open_time: string | null
  close_time: string | null
  is_published: boolean
  review_status: string
  visibility: string
  featured: boolean
  price_cents: number
  total_capacity: number | null
  /** Past relative to today, so the UI can separate upcoming from history. */
  past: boolean
  /** The Fourvenues event this night is sold through (HypeList), if any. */
  fourvenues_code?: string | null
  /** What the night is on sale as, from the hourly feed (fourvenues_nights.py). */
  fourvenues?: FourvenuesSnapshot | null
  /** Bookings made through the Club Fuoco app for this night. */
  bookings?: NightBooking[]
}

export interface FourvenuesRate {
  name: string | null
  price: number | null
  /** [smallest, largest] group size the table takes. */
  pax: [number, number] | null
  deposit: number | null
  deposit_type: string | null
  full_payment: boolean
}

export interface FourvenuesProduct {
  name: string | null
  /** free = guestlist · door = pay at the door · online = ticket · table = VIP zone */
  settle: 'free' | 'door' | 'online' | 'table'
  price: number | null
  sold_out: boolean
  /** Was on sale, gone from Fourvenues now (list closed, zone pulled). */
  unavailable?: boolean
  /** Not on sale yet — goes on sale at this time. */
  sale_starts?: string
  detail?: string
  rates?: FourvenuesRate[]
}

export interface FourvenuesSnapshot {
  url: string | null
  image: string | null
  min_age: number | null
  products: FourvenuesProduct[]
  seen_at: string
}

export interface NightBooking {
  id: string
  guest: string | null
  settle: string
  product: string | null
  heads: number
  /** Paid online, or owed at the door — euros. */
  amount: number
  has_qr: boolean
  created_at: string
}

// The night's columns; the Fourvenues pair only once migration
// 20261002_promoter_nights_fourvenues.sql is applied.
const BASE_COLS = 'id, title, night_date, club_id, location_name, open_time, close_time, is_published, review_status, visibility, featured, price_cents, total_capacity'
const FV_COLS = `${BASE_COLS}, fourvenues_code, fourvenues`

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()

  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)
  // No promoter account linked → nothing can be attributed to them yet.
  if (!brand.owner_user_id) return ok({ events: [], owner: null })

  // Paged, not `.limit(2000)`. PostgREST caps a response at 1000 rows however
  // large a limit is asked for, so a limit above it silently returns 1000 and
  // looks like the promoter simply has that many nights. BesoList is already
  // at 379 and climbing; a scraper-fed roster crosses 1000 without anyone
  // noticing the list stopped being complete. `id` is the tiebreaker so a page
  // boundary inside one date cannot drop or repeat a row.
  const PAGE = 1000
  const rows: Omit<BrandEvent, 'club_name' | 'past'>[] = []
  let cols = FV_COLS
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('promoter_nights')
      .select(cols)
      .eq('created_by', brand.owner_user_id)
      .order('night_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    // Migration not applied yet: the columns don't exist. Same page, without them.
    if (error && cols === FV_COLS && /fourvenues/.test(error.message)) { cols = BASE_COLS; from -= PAGE; continue }
    if (error) return err(error.message, 500)
    if (!data || data.length === 0) break
    rows.push(...(data as unknown as Omit<BrandEvent, 'club_name' | 'past'>[]))
    if (data.length < PAGE) break
  }

  // Resolve venue names in one query rather than per row.
  const clubIds = [...new Set(rows.map(r => r.club_id).filter((v): v is string => !!v))]
  const clubName = new Map<string, string>()
  if (clubIds.length) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', clubIds)
    for (const c of (clubs ?? []) as { id: string; name: string }[]) clubName.set(c.id, c.name)
  }

  // Compare as calendar dates, not timestamps: night_date is a local calendar
  // day, so a Date-based comparison would shift the boundary by the timezone.
  const today = new Date().toISOString().slice(0, 10)

  // Bookings made through the app, joined on the Fourvenues event code.
  const codes = [...new Set(rows.map(r => r.fourvenues_code).filter((v): v is string => !!v))]
  const bookingsByCode = await bookingsFor(sb, codes)

  const events: BrandEvent[] = rows.map(r => ({
    ...r,
    club_name: r.club_id ? clubName.get(r.club_id) ?? null : null,
    past: r.night_date < today,
    bookings: r.fourvenues_code ? bookingsByCode.get(r.fourvenues_code) ?? [] : [],
  }))

  return ok({ events, owner: brand.owner_user_id })
}

type Service = Awaited<ReturnType<typeof createServiceClient>>

async function bookingsFor(sb: Service, codes: string[]): Promise<Map<string, NightBooking[]>> {
  const out = new Map<string, NightBooking[]>()
  if (!codes.length) return out
  const tickets: {
    id: string; user_id: string; event_code: string; settle: string; product_name: string | null
    unit_price: number; heads: number; qr_payload: string | null; created_at: string
  }[] = []
  for (let i = 0; i < codes.length; i += 200) {
    const { data } = await sb.from('external_tickets')
      .select('id, user_id, event_code, settle, product_name, unit_price, heads, qr_payload, created_at')
      .eq('provider', 'fourvenues').in('event_code', codes.slice(i, i + 200))
      .order('created_at', { ascending: false })
    tickets.push(...(data ?? []))
  }
  const userIds = [...new Set(tickets.map(t => t.user_id))]
  const names = new Map<string, string>()
  if (userIds.length) {
    const { data } = await sb.from('users').select('id, full_name').in('id', userIds)
    for (const u of (data ?? []) as { id: string; full_name: string | null }[]) if (u.full_name) names.set(u.id, u.full_name)
  }
  for (const t of tickets) {
    const list = out.get(t.event_code) ?? []
    list.push({
      id: t.id,
      guest: names.get(t.user_id) ?? null,
      settle: t.settle,
      product: t.product_name,
      heads: t.heads,
      // A table's price is for the table; everything else is per head.
      amount: t.settle === 'table' ? Number(t.unit_price) : Number(t.unit_price) * t.heads,
      has_qr: !!t.qr_payload,
      created_at: t.created_at,
    })
    out.set(t.event_code, list)
  }
  return out
}
