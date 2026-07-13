import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { OfferSchema, OfferPatchSchema } from '@/lib/portal-schemas'
import { updateOffer, deleteOffer } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// PATCH /api/portal/offers/:offerId — edit an offer. The patch is merged onto
// the existing row and the merged object re-validated, so kind/price stay
// consistent (VIP ⇒ price, free ⇒ no price) no matter which subset is sent.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { offerId } = await params
  const parsed = OfferPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid patch')
  if (Object.keys(parsed.data).length === 0) return err('Nothing to update')

  const sb = await createServiceClient()
  // select('*') so the merge sees every column that exists (incl. is_active
  // once the archive migration lands) — zod strips the extras (id, brand_id…).
  const { data: existing } = await sb
    .from('partner_offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle()
  if (!existing) return err('Offer not found', 404)

  const patch = { ...parsed.data }
  // Flipping to free implies dropping the price — don't make the operator
  // clear it in a separate request.
  if (patch.kind === 'free_guestlist' && patch.price_eur === undefined) patch.price_eur = null

  const merged = OfferSchema.safeParse({
    ...existing,
    price_eur: existing.price_eur == null ? null : Number(existing.price_eur),
    ...patch,
  })
  if (!merged.success) return err(merged.error.issues[0]?.message ?? 'Invalid offer')

  try {
    await updateOffer(sb, offerId, patch)
    const isArchiveToggle = 'is_active' in patch && Object.keys(patch).length === 1
    const summary = isArchiveToggle
      ? `${patch.is_active ? 'Reactivated' : 'Deactivated'} offer “${existing.title}”`
      : `Edited offer “${existing.title}”`
    await logAudit(sb, { action: isArchiveToggle ? 'offer.archive' : 'offer.update', summary, target_type: 'offer', target_id: offerId, meta: patch })
    return ok({ updated: true })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not update offer', 500)
  }
}

// DELETE /api/portal/offers/:offerId — remove an offer.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { offerId } = await params
  const sb = await createServiceClient()
  const { data: existing } = await sb.from('partner_offers').select('title').eq('id', offerId).maybeSingle()
  try {
    await deleteOffer(sb, offerId)
    await logAudit(sb, { action: 'offer.delete', summary: `Deleted offer “${(existing as { title?: string } | null)?.title ?? offerId}”`, target_type: 'offer', target_id: offerId })
    return ok({ deleted: true })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not delete offer', 500)
  }
}
