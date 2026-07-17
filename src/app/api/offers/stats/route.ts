import { brandOrNull } from '@/lib/supplier-auth'
import { ok } from '@/lib/utils'

// GET /api/offers/stats — booking rollup for the caller's public offers, for
// the Statistics tab. Bookings through an offer live in rumbalist_purchases,
// matched to the offer by venue_id + product_kind (there's no brand/offer FK
// in the live schema — same matching the guests route uses). Aggregated
// server-side so the app makes one call instead of one per offer/night.
//
// A promoter with no brand yet (never published a public offer) gets zeroes,
// not a 403 — the Statistics tab is for everyone.

interface Bucket { bookings: number; people: number; arrived: number; revenue: number }
const empty = (): Bucket => ({ bookings: 0, people: 0, arrived: 0, revenue: 0 })

export async function GET() {
  const { brand, sb, response } = await brandOrNull()
  if (response) return response

  const zero = {
    overview: { thisMonth: empty(), allTime: empty(), liveOffers: 0, venues: 0 },
    byOffer: [] as unknown[],
  }
  if (!brand) return ok(zero)

  const { data: offers, error: offersErr } = await sb
    .from('partner_offers')
    .select('id, club_id, kind, title, is_active')
    .eq('brand_id', brand.id)
  if (offersErr || !offers?.length) return ok(zero)

  const monthPrefix = new Date().toISOString().slice(0, 7) // yyyy-MM
  const clubIds = [...new Set(offers.map(o => (o as { club_id: string }).club_id))]

  const { data: purchases, error: pErr } = await sb
    .from('rumbalist_purchases')
    .select('venue_id, product_kind, event_date, price_eur, booking:bookings ( checked_in_at, party_size )')
    .in('venue_id', clubIds)
  if (pErr) {
    // Drift-defensive: missing table/column → zeroes, not a broken tab.
    if (/does not exist|relation|schema cache/i.test(pErr.message)) return ok(zero)
    return ok(zero)
  }

  // One purchase belongs to an offer when venue + product kind both match.
  const offersByKey = new Map<string, { id: string; title: string; club_id: string }>()
  for (const o of offers) {
    const r = o as { id: string; club_id: string; kind: string; title: string }
    offersByKey.set(`${r.club_id}|${r.kind}`, { id: r.id, title: r.title, club_id: r.club_id })
  }

  const perOffer = new Map<string, Bucket & { title: string; clubId: string }>()
  const overview = { thisMonth: empty(), allTime: empty() }

  for (const p of purchases ?? []) {
    const row = p as {
      venue_id: string; product_kind: string; event_date: string; price_eur?: number | string | null
      booking?: { checked_in_at?: string | null; party_size?: number | null }
              | { checked_in_at?: string | null; party_size?: number | null }[]
    }
    const offer = offersByKey.get(`${row.venue_id}|${row.product_kind}`)
    if (!offer) continue

    const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking
    const people = booking?.party_size ?? 1
    const arrived = booking?.checked_in_at ? people : 0
    const revenue = Number(row.price_eur ?? 0) || 0

    const add = (b: Bucket) => { b.bookings += 1; b.people += people; b.arrived += arrived; b.revenue += revenue }
    add(overview.allTime)
    if ((row.event_date ?? '').startsWith(monthPrefix)) add(overview.thisMonth)

    const cur = perOffer.get(offer.id) ?? { ...empty(), title: offer.title, clubId: offer.club_id }
    cur.bookings += 1; cur.people += people; cur.arrived += arrived; cur.revenue += revenue
    perOffer.set(offer.id, cur)
  }

  return ok({
    overview: {
      ...overview,
      liveOffers: offers.filter(o => (o as { is_active: boolean }).is_active !== false).length,
      venues: clubIds.length,
    },
    byOffer: [...perOffer.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.people - a.people),
  })
}
