import { createServiceClient } from '@/lib/supabase/server'
import { ok } from '@/lib/utils'
import { getActiveBrand, getPartnerOffersByClub } from '@/lib/partner'

// GET /api/partner — the active guestlist partner's brand + all its offers,
// grouped by club id. Public (shown to guests / at first launch, pre-auth).
// Uncached so a partner switch propagates immediately; clients cache locally.
export async function GET() {
  const sb = await createServiceClient()
  const brand = await getActiveBrand(sb)
  if (!brand) return ok({ brand: null, offersByClub: {} })

  const offersByClub = await getPartnerOffersByClub(sb)
  return ok({
    brand: { key: brand.key, name: brand.name, logo_url: brand.logo_url, color: brand.color },
    offersByClub,
  })
}
