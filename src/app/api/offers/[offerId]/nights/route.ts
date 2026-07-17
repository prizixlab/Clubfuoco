import { NextRequest } from 'next/server'
import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { ok, err } from '@/lib/utils'

// PATCH /api/offers/:offerId/nights — turn ONE night of an offer off
// or back on. { date: 'yyyy-MM-dd', skipped: boolean }
//
// Separate from the offer PATCH on purpose. Every content change to an offer is
// queued for Club Fuoco review, but this is SCHEDULING, not content: a promoter
// cancelling this coming Monday can't wait three business days for approval, so
// it applies immediately. It also can't change what the offer IS — only whether
// it runs on a given date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { brand, sb, response } = await resolveSupplierBrand()
  if (response) return response
  const { offerId } = await params

  const body = await request.json().catch(() => null)
  const date = typeof body?.date === 'string' ? body.date.trim() : ''
  const skipped = body?.skipped
  if (!ISO_DATE.test(date)) return err('date must be yyyy-MM-dd')
  if (typeof skipped !== 'boolean') return err('skipped must be true or false')

  // Ownership boundary — same as every other supplier write.
  const { data: existing } = await sb
    .from('partner_offers')
    .select('brand_id, title, skipped_dates')
    .eq('id', offerId)
    .maybeSingle()
  if (!existing) return err('Offer not found', 404)
  const row = existing as { brand_id: string; title: string; skipped_dates?: string[] | null }
  if (row.brand_id !== brand.id) return err('Not your offer', 403)

  const current = new Set(row.skipped_dates ?? [])
  if (skipped) current.add(date)
  else current.delete(date)

  // Drop dates that have passed so the array can't grow forever.
  const today = new Date().toISOString().slice(0, 10)
  const next = [...current].filter(d => d >= today).sort()

  const { error } = await sb
    .from('partner_offers')
    .update({ skipped_dates: next })
    .eq('id', offerId)
  if (error) {
    // Drift-defensive: the column ships in a manual migration.
    if (/skipped_dates|column|schema cache/i.test(error.message)) {
      return err('Per-night scheduling needs the latest backend update.', 503)
    }
    return err(error.message, 500)
  }

  return ok({ date, skipped, skipped_dates: next })
}
