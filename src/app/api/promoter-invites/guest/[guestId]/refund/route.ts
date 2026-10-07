import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { refundQuote } from '@/lib/ticket-refund'

// POST /api/promoter-invites/guest/<guestId>/refund
//
// The guest refunds ONE event ticket from the Tickets tab: 90% back to the
// card that paid, Club Fuoco keeps 10%, until doors open (lib/ticket-refund).
//
// Order matters, because money only moves one way:
//   1. CLAIM the refund — flip this row paid → refunded with a conditional
//      update. Only one request can win it, so a double tap can't refund twice.
//   2. Ask Stripe for the partial refund (idempotency key per ticket, too).
//   3. Stripe refused → put the row back to paid. The guest keeps a working
//      ticket and is told nothing was refunded.
//
// The webhook's charge.refunded sees a PARTIAL refund here and leaves the
// other tickets on the charge alone — that's what makes it per ticket.
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

  const { data: row } = await sb
    .from('promoter_guests')
    .select('*, allocation:promoter_allocations ( night:promoter_nights ( night_date, open_time, title ) )')
    .eq('id', guestId)
    .maybeSingle()
  if (!row) return err('Ticket not found', 404)

  const g = row as {
    id: string; full_name: string; payment_status: string | null; amount_cents: number | null
    checked_in_at: string | null; claimed_by_user: string | null; purchased_by_user?: string | null
    paid_with?: string | null; stripe_payment_intent_id: string | null
    allocation: { night: { night_date: string; open_time: string | null; title: string | null } | null } | null
  }
  const night = g.allocation?.night
  if (!night) return err('Ticket not found', 404)

  const quote = refundQuote(g, night, userId)
  if (!quote.ok) return err(quote.reason, quote.status)

  // The charge lives on the lead row; a companion points at it.
  let paymentIntentId = g.stripe_payment_intent_id
  if (!paymentIntentId && g.paid_with) {
    const { data: lead } = await sb.from('promoter_guests')
      .select('stripe_payment_intent_id').eq('id', g.paid_with).maybeSingle()
    paymentIntentId = (lead as { stripe_payment_intent_id?: string | null } | null)?.stripe_payment_intent_id ?? null
  }
  if (!paymentIntentId) return err('Couldn’t find the payment for this ticket. Contact support.', 409)

  // 1. Claim it.
  const { data: claimed, error: claimErr } = await sb.from('promoter_guests')
    .update({ payment_status: 'refunded' })
    .eq('id', guestId).eq('payment_status', 'paid')
    .select('id')
  if (claimErr) return err('Couldn’t refund this ticket. Try again.', 500)
  if (!claimed?.length) return err('This ticket has already been refunded', 409)

  // 2. Move the money.
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: quote.refundCents,
      // A Connect sale: take the promoter's share of this refund back from
      // their account, as the original charge sent it there.
      ...(pi.transfer_data ? { reverse_transfer: true } : {}),
      metadata: { purpose: 'event_spot_refund', guest_id: guestId, refund_share: '0.9' },
    }, { idempotencyKey: `event-spot-refund-${guestId}` })

    return ok({
      refunded: true,
      refundCents: refund.amount,
      currency: refund.currency,
    })
  } catch (e) {
    // 3. Nothing was refunded — the ticket is theirs again.
    await sb.from('promoter_guests')
      .update({ payment_status: 'paid' })
      .eq('id', guestId).eq('payment_status', 'refunded')
    console.error('[refund] stripe refused', guestId, e instanceof Error ? e.message : e)
    return err('Couldn’t refund this ticket — nothing was refunded and it still works. Try again later.', 502)
  }
}
