import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

/**
 * Geofence-triggered auto check-in for an invite-claimed guest. Stamps
 * `promoter_guests.checked_in_at` once. The Fuoco consumer app calls this
 * from its background CLLocationManager region-entry handler.
 *
 * Auth: requires a logged-in Supabase user whose id matches
 * `promoter_guests.claimed_by_user` — prevents anyone from flipping someone
 * else's check-in. Service role under the hood (no RLS dependency) but we
 * verify the caller from the Bearer token ourselves.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params
  const sb = await createServiceClient()

  // Identify caller from Bearer
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp, error: userErr } = await sb.auth.getUser(bearer)
  if (userErr || !userResp.user) return err('Unauthorized', 401)
  const userId = userResp.user.id

  // Load guest, verify ownership
  const { data: guest, error: gErr } = await sb
    .from('promoter_guests')
    .select('id, claimed_by_user, checked_in_at, allocation:promoter_allocations(night:promoter_nights(night_date))')
    .eq('id', guestId)
    .single()
  if (gErr || !guest) return err('Guest not found', 404)
  if (guest.claimed_by_user !== userId) return err('Forbidden', 403)

  // Idempotent — first trigger wins
  if (guest.checked_in_at) {
    return ok({ checkedInAt: guest.checked_in_at, idempotent: true })
  }

  const now = new Date().toISOString()
  // A geofence-triggered check-in is itself proof the guest shared location,
  // so stamp consent alongside. Drift-defensive: if the location_consent
  // column isn't applied yet, retry with the check-in alone.
  let { error: updErr } = await sb
    .from('promoter_guests')
    .update({ checked_in_at: now, location_consent: true })
    .eq('id', guestId)
  if (updErr && /location_consent|column|schema cache/i.test(updErr.message ?? '')) {
    ;({ error: updErr } = await sb
      .from('promoter_guests')
      .update({ checked_in_at: now })
      .eq('id', guestId))
  }
  if (updErr) return err('Failed to check in', 500)

  return ok({ checkedInAt: now })
}
