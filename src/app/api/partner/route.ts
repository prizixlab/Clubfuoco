import { createServiceClient } from '@/lib/supabase/server'
import { ok } from '@/lib/utils'
import { getActiveBrand, getPartnerOffersByClub } from '@/lib/partner'
import { indexCatalog, loadCatalog, loadVipState, publicSellers, type PublicSellers } from '@/lib/vip-products'

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
// `vipSellers` (only with ?tables=1 — builds that sell VIP per table): club →
// night → table zone → which promoter holds that table's buy button and how
// it checks out (lib/vip-products). Builds released before don't ask, don't
// get it, and keep showing the Fourvenues listing as they always have.
export async function GET(request: Request) {
  const perTable = new URL(request.url).searchParams.get('tables') === '1'
  const sb = await createServiceClient()
  const [brand, offersByClub, vipSellers] = await Promise.all([
    getActiveBrand(sb),
    getPartnerOffersByClub(sb),
    perTable ? sellers(sb) : Promise.resolve(null),
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
    ...(vipSellers ? { vipSellers } : {}),
  })
}

/** Empty when the catalog can't be read — the app then keeps its own listing. */
async function sellers(sb: Awaited<ReturnType<typeof createServiceClient>>): Promise<PublicSellers> {
  const events = await loadCatalog()
  if (!events) return {}
  return publicSellers(await loadVipState(sb), indexCatalog(events))
}
