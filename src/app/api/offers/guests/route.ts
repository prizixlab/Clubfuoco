import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { ok, err } from '@/lib/utils'

// GET /api/offers/guests?club_id=<uuid>&date=<yyyy-MM-dd>
// The guests booked through this supplier's offers at one venue for one
// night: name, product, price, party size, and whether they checked in
// (via the linked bookings row). Powers the offer detail sheet in the app.
//
// Scoping: the caller must own a brand AND that brand must have an offer at
// the requested club — a supplier only ever sees traffic for venues they
// actually supply. Purchases are matched venue+date (rumbalist_purchases has
// no offer/brand link in the live schema); product_kind lets the app group
// per offer type.

export async function GET(req: Request) {
  const auth = await resolveSupplierBrand()
  if (auth.response) return auth.response
  const { brand, sb } = auth

  const url = new URL(req.url)
  const clubId = url.searchParams.get('club_id') ?? ''
  const date = url.searchParams.get('date') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(clubId)) return err('club_id required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('date must be yyyy-MM-dd')

  // The brand must supply this club.
  const { data: offer } = await sb
    .from('partner_offers')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('club_id', clubId)
    .limit(1)
    .maybeSingle()
  if (!offer) return err('No offers at this venue', 403)

  const { data, error } = await sb
    .from('rumbalist_purchases')
    .select(`
      id, full_name, product_kind, product_name, price_eur, event_date,
      booking:bookings ( checked_in_at, status, party_size )
    `)
    .eq('venue_id', clubId)
    .eq('event_date', date)
    .order('created_at', { ascending: true })

  if (error) {
    // Drift-defensive: a missing table/column yields an empty list, not a
    // broken sheet.
    if (/does not exist|relation|schema cache/i.test(error.message)) return ok([])
    return err(error.message, 500)
  }
  return ok(data ?? [])
}
