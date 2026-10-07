import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { openSpotHold, releaseUnpaidIntent } from '@/lib/spot-sale'

// POST /api/promoter-invites/<token>/payment-intent   { full_name, plus_ones? }
//
// The native Apple Pay path (app 1.14+). Same sale as /checkout — same checks,
// same hold, same money routing — but instead of a Stripe-hosted page it
// returns an UNCONFIRMED PaymentIntent, which the app confirms on-device with
// the Apple Pay sheet (ApplePayService.confirmIntent). The app then calls
// /guest/<id>/verify-payment, and the webhook's payment_intent.succeeded is
// the backstop, so the spot is marked paid whichever lands first.
//
// The hold row stores the PaymentIntent id from the start. That id is what
// lets the sweeper and verify-payment ask Stripe about a hold that has no
// Checkout session.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const sale = await openSpotHold(req, token)
  if (sale.kind === 'refused') return err(sale.message, sale.status)
  if (sale.kind === 'alreadyPaid') return ok({ alreadyPaid: true, guestId: sale.guestId })

  const { sb, guestId, night, eventName, heads, amount, currency, fee, feeBps, platformSettled, payout } = sale

  try {
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      // Apple Pay sends `card` payment methods.
      payment_method_types: ['card'],
      // Same routing as /checkout: a plain platform charge for a
      // platform-settled promoter, a destination charge with the promoter as
      // merchant of record for everyone else (see the comments there).
      ...(platformSettled ? {} : {
        application_fee_amount: fee,
        transfer_data: { destination: payout.stripe_account_id! },
        on_behalf_of: payout.stripe_account_id!,
      }),
      description: heads > 1
        ? `${eventName} · ${night.night_date} · entry for ${heads}`
        : `${eventName} · ${night.night_date}`,
      // `purpose` is what the webhook keys on. Never add `event_name` or
      // `qr_token` here — those route a PaymentIntent to the ticket-order and
      // booking handlers instead.
      metadata: {
        purpose: 'event_spot',
        guest_id: guestId,
        allocation_id: sale.allocationId,
        night_id: night.id,
        promoter_id: sale.promoterId,
        fee_bps: String(feeBps),
        settle: platformSettled ? 'platform' : 'connect',
      },
    })

    const { error: linkErr } = await sb.from('promoter_guests')
      .update({ stripe_payment_intent_id: intent.id })
      .eq('id', guestId)
    if (linkErr) {
      // Without the id on the row nothing could reconcile this payment, so
      // refuse it now while nobody has been charged.
      await stripe.paymentIntents.cancel(intent.id).catch(() => {})
      await sb.from('promoter_guests').delete().eq('id', guestId)
      return err('Couldn’t start the payment. You haven’t been charged.', 500)
    }

    return ok({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      guestId,
      amountCents: amount,
      currency,
    })
  } catch (e) {
    // Stripe refused. Release the hold immediately rather than leaving a spot
    // locked up by a payment that will never exist.
    await sb.from('promoter_guests').delete().eq('id', guestId)
    console.error('[payment-intent] stripe rejected the intent:',
      e instanceof Error ? e.message : e)
    return err('Couldn’t start the payment. You haven’t been charged.', 502)
  }
}

// DELETE /api/promoter-invites/<token>/payment-intent   { guest_id }  (or ?guest=<id>)
//
// The guest closed the Apple Pay sheet. Give the spot back now instead of
// leaving it held for half an hour.
//
// Cancel the PaymentIntent FIRST: once cancelled it can never succeed, so the
// row can be deleted without racing a late confirmation. If Stripe says it
// already succeeded, the spot is theirs — mark it paid, never delete it.
//
// Authorisation is holding the guest id, as with verify-payment. It can only
// ever release an unpaid hold.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  await params
  // Body (the app) or query string — either names the hold.
  const body = await req.json().catch(() => ({})) as { guest_id?: unknown }
  const guestId = typeof body.guest_id === 'string' ? body.guest_id
    : new URL(req.url).searchParams.get('guest')
  if (!guestId) return err('guest is required', 400)

  const sb = await createServiceClient()
  const { data: row } = await sb
    .from('promoter_guests')
    .select('id, payment_status, stripe_payment_intent_id, stripe_checkout_session_id')
    .eq('id', guestId)
    .maybeSingle()
  const guest = row as {
    id: string; payment_status: string | null
    stripe_payment_intent_id: string | null; stripe_checkout_session_id: string | null
  } | null
  if (!guest) return ok({ released: false })
  // Only an Apple Pay hold is released here. A Checkout hold belongs to its
  // session, and that expires on its own clock.
  if (guest.payment_status !== 'pending' || !guest.stripe_payment_intent_id
      || guest.stripe_checkout_session_id) {
    return ok({ released: false })
  }

  try {
    if (!(await releaseUnpaidIntent(guest.stripe_payment_intent_id))) {
      // It succeeded after all — the spot is theirs.
      await sb.from('promoter_guests')
        .update({ payment_status: 'paid', paid_at: new Date().toISOString(), hold_expires_at: null })
        .eq('id', guestId).eq('payment_status', 'pending')
      return ok({ released: false, paid: true })
    }
  } catch (e) {
    // Couldn't settle it with Stripe — leave the hold; it expires on its own
    // and the sweeper re-checks Stripe before deleting anything.
    console.warn('[payment-intent] could not release', guestId, e instanceof Error ? e.message : e)
    return ok({ released: false })
  }

  await sb.from('promoter_guests').delete().eq('id', guestId).eq('payment_status', 'pending')
  return ok({ released: true })
}
