import { NextRequest } from 'next/server'
import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { OfferSchema } from '@/lib/portal-schemas'
import { listBrandOffers, createOffer } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/supplier/offers — the caller's own offers (all clubs, incl. archived).
export async function GET() {
  const { brand, sb, response } = await resolveSupplierBrand()
  if (response) return response
  try {
    return ok(await listBrandOffers(sb, brand.id))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not list offers', 500)
  }
}

// POST /api/supplier/offers — create an offer on the caller's own brand. The
// brand id comes from the resolved account, never the request body, so a
// supplier can only ever write to their own brand.
export async function POST(request: NextRequest) {
  const { brand, sb, response } = await resolveSupplierBrand()
  if (response) return response
  const parsed = OfferSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid offer')
  try {
    return ok(await createOffer(sb, brand.id, parsed.data), 201)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not create offer', 500)
  }
}
