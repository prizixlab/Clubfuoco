import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// POST /api/promoter-invites/guest/<guestId>/attach
//
// Binds a spot claimed ANONYMOUSLY to the account that just signed in.
//
// The claim endpoint has always accepted callers with no session — someone
// tapping an invite in an Instagram webview has no account and must still get
// on the list. The cost is that `claimed_by_user` stays null, so the spot lives
// only in the view state of one screen: relaunch the app and the ticket is
// gone, it never reaches the Tickets tab, and the Wallet pass is a URL nobody
// remembers. This is the step that fixes that, and it is why the reduced signup
// exists at all — not to gate the claim, but to make the claim keep.
//
// AUTHORISATION, and why holding the id is enough: promoter_guests.id IS the
// secret encoded in the guest's QR (`fuoco-invite:<uuid>`), 122 bits of it.
// Anyone who can present it can already walk through the door as that guest, so
// requiring anything further would protect nothing. What is guarded is the
// case that actually matters — a spot that ALREADY belongs to someone is never
// reassigned.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)

  const sb = await createServiceClient()
  const { data: userResp } = await sb.auth.getUser(bearer)
  const userId = userResp.user?.id
  if (!userId) return err('Unauthorized', 401)

  const { data: guest } = await sb
    .from('promoter_guests')
    .select('id, full_name, plus_ones, claimed_by_user, allocation_id')
    .eq('id', guestId)
    .maybeSingle()
  if (!guest) return err('Spot not found', 404)

  // Already theirs — idempotent, because the app retries this after a flaky
  // sign-in and must not present that as a failure.
  if (guest.claimed_by_user === userId) {
    return ok({ attached: true, alreadyMine: true, guest })
  }
  // Somebody else's. Never reassign: the anonymous window is the only time a
  // spot is unowned, and once closed it stays closed.
  if (guest.claimed_by_user) return err('That spot already belongs to another account', 409)

  // One claim per user per allocation — the same rule the claim endpoint
  // enforces, backed by the partial unique index from promoter_series.sql.
  // Without this check a guest could claim anonymously, sign in, and end up
  // holding two spots on one list.
  const { data: existing } = await sb
    .from('promoter_guests')
    .select('id')
    .eq('allocation_id', guest.allocation_id)
    .eq('claimed_by_user', userId)
    .maybeSingle()
  if (existing) {
    return err('You already have a spot on this list', 409)
  }

  const { data: updated, error } = await sb
    .from('promoter_guests')
    .update({ claimed_by_user: userId })
    .eq('id', guestId)
    .is('claimed_by_user', null)      // lost a race → the guard above stands
    .select('id, full_name, plus_ones')
    .maybeSingle()

  if (error) return err(error.message, 500)
  if (!updated) return err('That spot already belongs to another account', 409)

  return ok({ attached: true, guest: updated })
}
