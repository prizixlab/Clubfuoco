import { createServiceClient } from '@/lib/supabase/server'
import { ok } from '@/lib/utils'
import { getActiveBrand, getPartnerOffersByClub, getPublicTables } from '@/lib/partner'

// GET /api/partner — every LIVE guestlist offer, grouped by club id, each
// carrying its own supplying brand. Public (shown to guests / at first launch,
// pre-auth). Uncached so a change propagates immediately; clients cache locally.
//
// Offers come from MANY brands: promoters and suppliers are one role, so any
// promoter can publish a public offer under their own brand (provisioned on
// their first one). Attribution therefore rides on each offer — `brand` below
// is only the primary/featured supplier, kept for older clients that still read
// a single app-wide brand.
//
// `tables` (club id → table decisions, lib/table-products): every VIP table is
// its own product. offersByClub already reflects them for our listings; the app
// uses `tables` to hide Fourvenues zones whose table went to someone else, and
// its mere presence tells a newer app this server sells per table — so it
// stops hiding all of our tables whenever Fourvenues sells one. Older apps
// don't decode the key and behave exactly as before.
export async function GET() {
  const sb = await createServiceClient()
  const [brand, offersByClub, tables] = await Promise.all([
    getActiveBrand(sb),
    getPartnerOffersByClub(sb),
    getPublicTables(sb),
  ])

  // Distinct brands actually referenced by live offers — lets a client resolve
  // attribution without walking every offer.
  const brands = Object.values(offersByClub)
    .flat()
    .map(o => o.brand)
    .filter((b): b is NonNullable<typeof b> => !!b)
    .reduce((acc, b) => {
      if (!acc.some(x => x.key === b.key)) acc.push(b)
      return acc
    }, [] as NonNullable<(typeof offersByClub)[string][number]['brand']>[])

  return ok({
    brand: brand
      ? {
          key:                  brand.key,
          name:                 brand.name,
          logo_url:             brand.logo_url,
          color:                brand.color,
          attribution_required: brand.attribution_required,
          attribution_label:    brand.attribution_label,
        }
      : null,
    brands,
    offersByClub,
    tables,
  })
}
