import { NextRequest } from 'next/server'
import { resolveOfferBrand } from '@/lib/offer-auth'
import { OfferSchema, OfferPatchSchema } from '@/lib/portal-schemas'
import { enqueueOrApplyDirect } from '@/lib/pending-changes'
import { ok, err } from '@/lib/utils'

// Verify the offer exists AND belongs to the caller's brand — the ownership
// boundary for every offer write. Returns the existing row or an error
// response (404 unknown / 403 someone else's offer).
async function ownedOffer(offerId: string, brandId: string, sb: Awaited<ReturnType<typeof resolveOfferBrand>>['sb']) {
  const { data } = await sb!
    .from('partner_offers')
    .select('brand_id, club_id, kind, title, subtitle, price_eur, party_size, time_window, valid_days, dress_code, music, sort_order')
    .eq('id', offerId)
    .maybeSingle()
  if (!data) return { error: err('Offer not found', 404) }
  if ((data as { brand_id: string }).brand_id !== brandId) return { error: err('Not your offer', 403) }
  return { existing: data }
}

// PATCH /api/offers/:offerId — edit one of the caller's own offers.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { brand, userId, sb, response } = await resolveOfferBrand()
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

  // Queue for review — the live offer keeps its current values until approved.
  const isToggle = 'is_active' in patch && Object.keys(patch).length === 1
  const verb = isToggle ? (patch.is_active ? 'reactivate' : 'deactivate') : 'edit'
  try {
    const { queued } = await enqueueOrApplyDirect(sb, {
      source: 'supplier', submitter_user_id: userId, brand_id: brand.id,
      action: 'offer.update', entity: 'offer', target_id: offerId, payload: patch,
      summary: `${brand.name}: ${verb} “${(existing as { title: string }).title}”`,
    })
    return ok({ pending: queued, updated: !queued }, queued ? 202 : 200)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not submit change', 500)
  }
}

// DELETE /api/offers/:offerId — remove one of the caller's own offers.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { brand, userId, sb, response } = await resolveOfferBrand()
  if (response) return response
  const { offerId } = await params

  const owned = await ownedOffer(offerId, brand.id, sb)
  if (owned.error) return owned.error

  // Removing your OWN offer is purely subtractive — it can only make the offer
  // LESS visible, never surface unvetted public content (the one thing the
  // review queue guards). Like per-night skip and deactivation, an owner must
  // be able to pull their offer down immediately, not wait three business days.
  // So apply directly; ownership is already verified above. An approved audit
  // row is still recorded for the trail.
  try {
    const { queued } = await enqueueOrApplyDirect(sb, {
      source: 'supplier', submitter_user_id: userId, brand_id: brand.id,
      action: 'offer.delete', entity: 'offer', target_id: offerId,
      summary: `${brand.name}: remove “${(owned.existing as { title: string }).title}”`,
    }, { forceDirect: true })
    return ok({ pending: queued, deleted: !queued }, queued ? 202 : 200)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not submit removal', 500)
  }
}
