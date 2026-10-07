import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/portal/brands/:id/revenue — what this promoter's nights took
// through Club Fuoco, for invoicing them later.
//
// Two sources, one ledger:
//   * Fourvenues sales (`external_tickets`) — tickets, tables and lists sold
//     in the app on the promoter's Fourvenues events. Linked through
//     promoter_nights.fourvenues_code, which only exists on nights the
//     promoter owns, so a sale can't be credited to the wrong promoter.
//   * Club Fuoco's own bookings (`bookings.brand_id`) — offers and nights
//     booked natively, paid through our Stripe or free.
//
// Revenue is what the GUEST paid or owes for it — the promoter's gross from
// us, not our commission: the rate differs per deal (see the promoter's
// agreement), so it is applied on the invoice, not baked in here.
//
//   online  paid in the app (Fourvenues checkout or our Stripe)
//   door    pay-at-the-door lists booked through us — paid at the venue
//   table   VIP tables — the table's price, deposit or not
//   free    guestlist sign-ups: €0, counted for heads
//
// Cancelled and failed bookings are left out. Read-only.

export interface RevenueLine {
  id: string
  source: 'fourvenues' | 'clubfuoco'
  /** When the guest booked (ISO). */
  booked_at: string
  /** The night it's for (YYYY-MM-DD). */
  night: string
  event: string | null
  product: string | null
  kind: 'online' | 'door' | 'table' | 'free'
  guests: number
  amount: number
  guest: string | null
}

export interface RevenueMonth {
  /** "2026-10" — by the NIGHT's month, the period you'd invoice. */
  month: string
  bookings: number
  guests: number
  online: number
  door: number
  table: number
  total: number
}

const round = (n: number) => Math.round(n * 100) / 100

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

  const lines: RevenueLine[] = []
  const userIds = new Set<string>()

  // ── Fourvenues sales on this promoter's nights ─────────────────────────────
  if (brand.owner_user_id) {
    const nights = new Map<string, { title: string | null; night_date: string }>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('promoter_nights')
        .select('fourvenues_code, title, night_date')
        .eq('created_by', brand.owner_user_id).not('fourvenues_code', 'is', null)
        .order('id').range(from, from + 999)
      // Before migration 20261002 the column doesn't exist: no Fourvenues sales.
      if (error) break
      for (const n of (data ?? []) as { fourvenues_code: string; title: string | null; night_date: string }[]) {
        nights.set(n.fourvenues_code, n)
      }
      if (!data || data.length < 1000) break
    }
    const codes = [...nights.keys()]
    for (let i = 0; i < codes.length; i += 200) {
      const { data } = await sb.from('external_tickets')
        .select('id, user_id, event_code, event_name, night, settle, product_name, unit_price, heads, created_at')
        .eq('provider', 'fourvenues').in('event_code', codes.slice(i, i + 200))
      for (const t of (data ?? []) as {
        id: string; user_id: string; event_code: string; event_name: string | null; night: string
        settle: string; product_name: string | null; unit_price: number; heads: number; created_at: string
      }[]) {
        const n = nights.get(t.event_code)
        const kind = (['online', 'door', 'table', 'free'].includes(t.settle) ? t.settle : 'online') as RevenueLine['kind']
        userIds.add(t.user_id)
        lines.push({
          id: t.id, source: 'fourvenues', booked_at: t.created_at,
          night: n?.night_date ?? t.night, event: n?.title ?? t.event_name, product: t.product_name,
          kind, guests: t.heads,
          // A table's price is for the table; everything else is per head.
          amount: round(kind === 'table' ? Number(t.unit_price) : Number(t.unit_price) * t.heads),
          guest: t.user_id,
        })
      }
    }
  }

  // ── Club Fuoco's own bookings under this brand ─────────────────────────────
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('bookings')
      .select('id, user_id, booking_date, party_size, total_amount, status, created_at, clubs(name)')
      .eq('brand_id', id).not('status', 'in', '(cancelled,payment_failed,refunded,disputed)')
      .order('id').range(from, from + 999)
    if (error) return err(error.message, 500)
    for (const b of (data ?? []) as unknown as {
      id: string; user_id: string; booking_date: string; party_size: number | null
      total_amount: number | null; created_at: string; clubs: { name: string } | null
    }[]) {
      const amount = round(Number(b.total_amount ?? 0))
      userIds.add(b.user_id)
      lines.push({
        id: b.id, source: 'clubfuoco', booked_at: b.created_at, night: b.booking_date,
        event: b.clubs?.name ?? null, product: amount > 0 ? 'Booking' : 'Guestlist',
        kind: amount > 0 ? 'online' : 'free', guests: b.party_size ?? 1, amount, guest: b.user_id,
      })
    }
    if (!data || data.length < 1000) break
  }

  // Guest names, in one query.
  const names = new Map<string, string>()
  const ids = [...userIds]
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('users').select('id, full_name').in('id', ids.slice(i, i + 200))
    for (const u of (data ?? []) as { id: string; full_name: string | null }[]) if (u.full_name) names.set(u.id, u.full_name)
  }
  for (const l of lines) l.guest = l.guest ? names.get(l.guest) ?? null : null

  lines.sort((a, b) => b.booked_at.localeCompare(a.booked_at))

  // By the night's month — the period an invoice covers.
  const byMonth = new Map<string, RevenueMonth>()
  for (const l of lines) {
    const month = l.night.slice(0, 7)
    const m = byMonth.get(month) ?? { month, bookings: 0, guests: 0, online: 0, door: 0, table: 0, total: 0 }
    m.bookings += 1
    m.guests += l.guests
    if (l.kind === 'online') m.online += l.amount
    if (l.kind === 'door') m.door += l.amount
    if (l.kind === 'table') m.table += l.amount
    m.total += l.amount
    byMonth.set(month, m)
  }
  const months = [...byMonth.values()]
    .map(m => ({ ...m, online: round(m.online), door: round(m.door), table: round(m.table), total: round(m.total) }))
    .sort((a, b) => b.month.localeCompare(a.month))

  return ok({ currency: 'EUR', months, lines })
}
