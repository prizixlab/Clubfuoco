import { NextRequest } from 'next/server'
import { brandOrNull, resolveOrProvisionBrand } from '@/lib/supplier-auth'
import { OfferSchema } from '@/lib/portal-schemas'
import { listBrandOffers } from '@/lib/partner'
import { enqueueOrApplyDirect } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

// GET /api/supplier/offers — the caller's own LIVE offers (all clubs, incl.
// archived). Pending (unapproved) changes are served separately from
// /api/supplier/pending so the app can show them as "in review".
export async function GET() {
  const { brand, sb, response } = await brandOrNull()
  if (response) return response
  // No brand yet = this promoter has never published a public offer. That's
  // an empty list, not an error.
  if (!brand) return ok([])
  try {
    return ok(await listBrandOffers(sb, brand.id))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not list offers', 500)
  }
}

// POST /api/supplier/offers — submit a new offer for review. It does NOT go live
// until Club Fuoco staff approve it in the portal; we queue the change instead
// of writing to the live table. Brand id comes from the resolved account.
export async function POST(request: NextRequest) {
  // Provisions the promoter's brand on their first public offer.
  const { brand, userId, sb, response } = await resolveOrProvisionBrand()
  if (response) return response
  const parsed = OfferSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid offer')

  const { data: club } = await sb.from('clubs').select('name').eq('id', parsed.data.club_id).maybeSingle()
  const clubName = (club as { name?: string } | null)?.name ?? 'a venue'
  try {
    const { queued } = await enqueueOrApplyDirect(sb, {
      source: 'supplier', submitter_user_id: userId, brand_id: brand.id,
      action: 'offer.create', entity: 'offer', payload: parsed.data,
      summary: `${brand.name}: add “${parsed.data.title}” at ${clubName}`,
    })
    return ok({ pending: queued }, queued ? 202 : 201)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not submit offer', 500)
  }
}
