import { NextRequest } from 'next/server'
import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { OfferSchema, OfferPatchSchema } from '@/lib/portal-schemas'
import { updateOffer, deleteOffer } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// Verify the offer exists AND belongs to the caller's brand — the ownership
// boundary for every supplier write. Returns the existing row or an error
// response (404 unknown / 403 someone else's offer).
async function ownedOffer(offerId: string, brandId: string, sb: Awaited<ReturnType<typeof resolveSupplierBrand>>['sb']) {
  const { data } = await sb!
    .from('partner_offers')
    .select('brand_id, club_id, kind, title, subtitle, price_eur, party_size, time_window, valid_days, dress_code, music, sort_order')
    .eq('id', offerId)
    .maybeSingle()
  if (!data) return { error: err('Offer not found', 404) }
  if ((data as { brand_id: string }).brand_id !== brandId) return { error: err('Not your offer', 403) }
  return { existing: data }
}

// PATCH /api/supplier/offers/:offerId — edit one of the caller's own offers.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { brand, sb, response } = await resolveSupplierBrand()
  if (response) return response
  const { offerId } = await params

  const parsed = OfferPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid patch')
  if (Object.keys(parsed.data).length === 0) return err('Nothing to update')

  const owned = await ownedOffer(offerId, brand.id, sb)
  if (owned.error) return owned.error
  const existing = owned.existing!

  const patch = { ...parsed.data }
  // Flipping to free implies clearing the price (mirrors the portal editor).
  if (patch.kind === 'free_guestlist' && patch.price_eur === undefined) patch.price_eur = null

  // Re-validate the merged row so VIP/price stay consistent across partial edits.
  const merged = OfferSchema.safeParse({
    ...existing,
    price_eur: (existing as { price_eur: number | null }).price_eur == null ? null : Number((existing as { price_eur: number }).price_eur),
    ...patch,
  })
  if (!merged.success) return err(merged.error.issues[0]?.message ?? 'Invalid offer')

  try {
    await updateOffer(sb, offerId, patch)
    return ok({ updated: true })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not update offer', 500)
  }
}

// DELETE /api/supplier/offers/:offerId — remove one of the caller's own offers.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { brand, sb, response } = await resolveSupplierBrand()
  if (response) return response
  const { offerId } = await params

  const owned = await ownedOffer(offerId, brand.id, sb)
  if (owned.error) return owned.error

  try {
    await deleteOffer(sb, offerId)
    return ok({ deleted: true })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not delete offer', 500)
  }
}
