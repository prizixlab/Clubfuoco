import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { OfferSchema } from '@/lib/portal-schemas'
import { getBrand, listBrandOffers, createOffer, duplicateOffers } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/portal/brands/:id/offers — the brand's offers (all clubs, ordered).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()
  try {
    return ok(await listBrandOffers(sb, id))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not list offers', 500)
  }
}

// POST /api/portal/brands/:id/offers — create one offer, OR bulk-duplicate
// another brand's offers with { duplicate_from: <brandId> } (skips clubs this
// brand already covers — fast way to stand up a new partner).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const body = await request.json().catch(() => null)
  const sb = await createServiceClient()

  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)

  if (typeof body?.duplicate_from === 'string') {
    const source = await getBrand(sb, body.duplicate_from)
    if (!source) return err('Source brand not found', 404)
    try {
      const copied = await duplicateOffers(sb, source.id, id)
      return ok({ copied })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Could not duplicate offers', 500)
    }
  }

  const parsed = OfferSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid offer')
  try {
    return ok(await createOffer(sb, id, parsed.data), 201)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not create offer', 500)
  }
}
