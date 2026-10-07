import { createServiceClient } from '@/lib/supabase/server'
import { holdPaidOnStripe } from '@/lib/spot-sale'
import { ok, err } from '@/lib/utils'

// POST /api/promoter-invites/guest/<guestId>/verify-payment
//
// "I just paid — where's my ticket?"
//
// The webhook is the source of truth and it is almost always faster than the
// guest. But it can be late, or fail, and the sweeper that would otherwise
// rescue the spot runs DAILY (Vercel's Hobby plan refuses a cron more frequent
// than once a day). Waiting a day is fine for tidying up litter and completely
// unacceptable for somebody standing there having been charged.
//
// So the app calls this when it lands on a ticket that isn't paid yet: ask
// Stripe directly, and honour the answer immediately.
//
// Authorisation is holding the guest id, same as the QR itself — and this can
// only ever move a spot from pending to paid, using Stripe's word rather than
// the caller's, so it grants nothing an attacker wants.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params
  const sb = await createServiceClient()

  const { data: guest } = await sb
    .from('promoter_guests')
    .select('id, payment_status, stripe_checkout_session_id, stripe_payment_intent_id')
    .eq('id', guestId)
    .maybeSingle()
  if (!guest) return err('Spot not found', 404)

  const row = guest as {
    id: string; payment_status?: string
    stripe_checkout_session_id?: string | null; stripe_payment_intent_id?: string | null
  }
  const status = row.payment_status ?? 'free'

  // Already settled, or never needed paying. Nothing to ask Stripe.
  if (status === 'paid' || status === 'free') return ok({ paid: true, status })
  if (status === 'refunded' || status === 'disputed') return ok({ paid: false, status })
  if (!row.stripe_checkout_session_id && !row.stripe_payment_intent_id) return ok({ paid: false, status })

  try {
    // A Checkout session (web) or a bare PaymentIntent (native Apple Pay).
    const stripeSays = await holdPaidOnStripe(row)
    if (!stripeSays.paid) {
      return ok({ paid: false, status: 'pending' })
    }
    const { error } = await sb
      .from('promoter_guests')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        hold_expires_at: null,
        stripe_payment_intent_id: stripeSays.paymentIntentId,
      })
      .eq('id', guestId)
      .eq('payment_status', 'pending')   // idempotent, and never un-refunds a spot
    if (error) return err('Could not record the payment', 500)
    return ok({ paid: true, status: 'paid' })
  } catch (e) {
    console.error('[verify-payment]', guestId, e instanceof Error ? e.message : e)
    // Stripe unreachable. Say nothing false — the webhook and the sweeper are
    // both still coming.
    return err('Couldn’t confirm the payment yet. Give it a moment.', 502)
  }
}
