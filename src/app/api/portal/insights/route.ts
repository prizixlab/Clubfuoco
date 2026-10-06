import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/insights — everything booked through the app, by venue.
//
// Three sources, one ledger (30-day window, by when it was booked):
//   * bookings          — partner offers: free guestlist (general) / VIP table
//   * promoter_guests   — spots on our EVENTS (D9 etc.): a free claim, or a
//                         paid ticket. Counted at the night's venue. Unpaid
//                         holds and refunds are not bookings. A feed
//                         reservation writes BOTH a booking and a guest row —
//                         the booking already counts it, so that guest row is
//                         skipped (same user + same night).
//   * external_tickets  — Fourvenues lists, tickets and tables bought in the
//                         app, at the venue they're for.
// This tab used to read `bookings` alone, so event sales never reached a venue.

type Kind = 'free' | 'vip' | 'ticket'
type Line = {
  id: string; venueKey: string; venue: string; kind: Kind; source: 'offer' | 'event' | 'fourvenues'
  status: string; created_at: string; checked_in: boolean; amount: number | null
}

const KIND_LABEL: Record<Kind, string> = { free: 'Free Guestlist', vip: 'VIP Table', ticket: 'Ticket' }
const SOURCE_LABEL: Record<Line['source'], string> = { offer: '', event: 'Event', fourvenues: 'Fourvenues' }

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const lines: Line[] = []
  const clubIds = new Set<string>()

  // ── Partner offers ────────────────────────────────────────────────────────
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, user_id, club_id, night_id, booking_type, status, created_at, total_amount, checked_in_at')
    .gte('created_at', since)
  if (error) return err(error.message, 500)
  const bookedNight = new Set<string>()
  for (const b of (bookings ?? []) as {
    id: string; user_id: string; club_id: string; night_id: string | null; booking_type: string
    status: string; created_at: string; total_amount: number | null; checked_in_at: string | null
  }[]) {
    if (b.status === 'cancelled') continue
    if (b.night_id) bookedNight.add(`${b.user_id}|${b.night_id}`)
    clubIds.add(b.club_id)
    lines.push({
      id: b.id, venueKey: b.club_id, venue: '', source: b.night_id ? 'event' : 'offer',
      kind: b.booking_type === 'vip' ? 'vip' : (b.total_amount ?? 0) > 0 ? 'ticket' : 'free',
      status: b.status, created_at: b.created_at, checked_in: !!b.checked_in_at, amount: b.total_amount ?? null,
    })
  }

  // ── Event spots ───────────────────────────────────────────────────────────
  const { data: guests } = await sb
    .from('promoter_guests')
    .select(`id, claimed_by_user, payment_status, amount_cents, plus_ones, created_at, checked_in_at,
             allocation:promoter_allocations ( night:promoter_nights ( id, club_id, location_name ) )`)
    .gte('created_at', since)
    .or('payment_status.is.null,payment_status.not.in.(pending,refunded)')
  for (const g of (guests ?? []) as unknown as {
    id: string; claimed_by_user: string | null; payment_status: string | null; amount_cents: number | null
    created_at: string; checked_in_at: string | null
    allocation: { night: { id: string; club_id: string | null; location_name: string | null } | null } | null
  }[]) {
    const night = g.allocation?.night
    if (!night) continue
    if (g.claimed_by_user && bookedNight.has(`${g.claimed_by_user}|${night.id}`)) continue
    const paid = g.payment_status === 'paid' && (g.amount_cents ?? 0) > 0
    if (night.club_id) clubIds.add(night.club_id)
    lines.push({
      id: g.id, venueKey: night.club_id ?? `loc:${night.location_name ?? 'Event'}`,
      venue: night.club_id ? '' : night.location_name ?? 'Event', source: 'event',
      kind: paid ? 'ticket' : 'free', status: 'confirmed', created_at: g.created_at,
      checked_in: !!g.checked_in_at, amount: paid ? (g.amount_cents ?? 0) / 100 : null,
    })
  }

  // ── Fourvenues ────────────────────────────────────────────────────────────
  const { data: ext } = await sb
    .from('external_tickets')
    .select('id, club_id, venue, settle, unit_price, heads, created_at')
    .gte('created_at', since)
  for (const t of (ext ?? []) as {
    id: string; club_id: string | null; venue: string | null; settle: string
    unit_price: number | null; heads: number | null; created_at: string
  }[]) {
    if (t.club_id) clubIds.add(t.club_id)
    const kind: Kind = t.settle === 'table' ? 'vip' : t.settle === 'free' ? 'free' : 'ticket'
    const price = Number(t.unit_price ?? 0)
    lines.push({
      id: t.id, venueKey: t.club_id ?? `name:${(t.venue ?? '—').toLowerCase()}`,
      venue: t.club_id ? '' : t.venue ?? '—', source: 'fourvenues', kind,
      status: 'confirmed', created_at: t.created_at, checked_in: false,
      amount: price > 0 ? (kind === 'vip' ? price : price * Math.max(1, t.heads ?? 1)) : null,
    })
  }

  // Club names, one query.
  const nameById: Record<string, string> = {}
  if (clubIds.size) {
    const { data: clubs } = await sb.from('clubs').select('id, name').in('id', [...clubIds])
    for (const c of (clubs ?? []) as { id: string; name: string }[]) nameById[c.id] = c.name
  }
  for (const l of lines) if (!l.venue) l.venue = nameById[l.venueKey] ?? '—'
  lines.sort((a, b) => b.created_at.localeCompare(a.created_at))

  const dayMs = 24 * 3600 * 1000
  const now = Date.now()
  const within = (l: Line, days: number) => now - new Date(l.created_at).getTime() <= days * dayMs

  const trend: { date: string; count: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const key = new Date(now - i * dayMs).toISOString().slice(0, 10)
    trend.push({ date: key, count: lines.filter(l => l.created_at.slice(0, 10) === key).length })
  }

  const byVenue: Record<string, { club: string; free: number; vip: number; ticket: number }> = {}
  for (const l of lines) {
    const v = (byVenue[l.venueKey] ??= { club: l.venue, free: 0, vip: 0, ticket: 0 })
    v[l.kind]++
  }
  const byClub = Object.values(byVenue)
    .map(v => ({ ...v, total: v.free + v.vip + v.ticket }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  const recent = lines.slice(0, 20).map(l => ({
    id: l.id, club: l.venue,
    kind: [KIND_LABEL[l.kind], SOURCE_LABEL[l.source]].filter(Boolean).join(' · '),
    status: l.status, created_at: l.created_at, checked_in: l.checked_in, amount: l.amount,
  }))

  return ok({
    totals: {
      last7:       lines.filter(l => within(l, 7)).length,
      last30:      lines.length,
      vip30:       lines.filter(l => l.kind === 'vip').length,
      free30:      lines.filter(l => l.kind === 'free').length,
      ticket30:    lines.filter(l => l.kind === 'ticket').length,
      checkedIn30: lines.filter(l => l.checked_in).length,
    },
    trend,
    byClub,
    recent,
  })
}
