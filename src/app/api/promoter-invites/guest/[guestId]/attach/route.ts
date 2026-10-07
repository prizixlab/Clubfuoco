import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { NON_ADMITTING_PAYMENT } from '@/lib/refunds'

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

  // `*`: purchased_by_user / payment_status are read below, and naming
  // purchased_by_user would fail before the 20261007 migration.
  const { data: row } = await sb
    .from('promoter_guests')
    .select('*')
    .eq('id', guestId)
    .maybeSingle()
  if (!row) return err('Spot not found', 404)
  const { purchased_by_user: purchasedBy, payment_status: paymentStatus, ...rest } = row as {
    id: string; full_name: string; plus_ones: number; claimed_by_user: string | null
    allocation_id: string; purchased_by_user?: string | null; payment_status?: string | null
  }
  const guest = { id: rest.id, full_name: rest.full_name, plus_ones: rest.plus_ones,
                  claimed_by_user: rest.claimed_by_user, allocation_id: rest.allocation_id }

  // A refunded or unpaid ticket can't be handed on — it wouldn't open the door.
  if (NON_ADMITTING_PAYMENT.has(paymentStatus ?? 'free')) {
    return err('This ticket is no longer valid', 409)
  }
  // A ticket bought FOR someone else, opened by the buyer (tapping their own
  // "send" link to check it). It stays theirs to hold and send — attaching it
  // would make it their own spot and take it off the friend.
  if (!guest.claimed_by_user && purchasedBy === userId) {
    return ok({ attached: false, heldByYou: true, guest })
  }

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
