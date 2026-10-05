import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { openSpotHold, HOLD_MINUTES } from '@/lib/spot-sale'

// POST /api/promoter-invites/<token>/checkout   { full_name, plus_ones? }
//
// Buying a spot on a paid night. Returns a Stripe Checkout URL; the spot is
// only really theirs once the webhook says the money landed.
//
// The money never passes through us. `transfer_data.destination` sends it
// straight to the promoter's own Connect account and `application_fee_amount`
// keeps our cut — so there is no payout to run, no balance to reconcile, and no
// point at which a person at Club Fuoco has to do anything. (Platform-settled
// promoters are the exception — see isPlatformSettled.)
//
// Every check that can refuse the sale is in lib/spot-sale, shared with the
// native Apple Pay path (/payment-intent).

/** Where Stripe Checkout returns the buyer — see success_url. */
const RETURN_HOST = 'https://clubfuoco.vercel.app'

/** Stripe's hard minimum for `expires_at`, in minutes. */
const STRIPE_MIN_SESSION_MINUTES = 30

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const sale = await openSpotHold(req, token)
  if (sale.kind === 'refused') return err(sale.message, sale.status)
  if (sale.kind === 'alreadyPaid') return ok({ alreadyPaid: true, guestId: sale.guestId })

  const { sb, night, eventName, heads, amount, currency, fee, feeBps, platformSettled, payout, now } = sale
  const guest = { id: sale.guestId }
  const alloc = { id: sale.allocationId, promoter_id: sale.promoterId }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: eventName,
            description: heads > 1
              ? `Entry for ${heads} · ${night.night_date}`
              : `Entry · ${night.night_date}`,
          },
        },
      }],
      payment_intent_data: {
        // Platform-settled: a plain charge on our own account — no transfer,
        // no fee, no on_behalf_of. Everything below applies to Connect sales.
        ...(platformSettled ? {} : {
          application_fee_amount: fee,
          transfer_data: { destination: payout.stripe_account_id! },
          // WHO IS THE SELLER. Without on_behalf_of the charge is created on the
          // PLATFORM account: Club Fuoco becomes merchant of record, the charge
          // settles under our US entity, and — the part that costs money — a
          // chargeback debits OUR balance even though the funds were already
          // transferred to the promoter. We would be paying back money we no
          // longer hold.
          //
          // on_behalf_of makes the connected account the merchant of record. The
          // charge settles in their country and currency (which is also what
          // makes a EUR price coherent under a US platform), their name is on the
          // statement, and a dispute comes out of their balance, where the sale
          // happened.
          on_behalf_of: payout.stripe_account_id!,
        }),
        // On the promoter's statement, not ours — they are the seller.
        description: `${eventName} · ${night.night_date}`,
        metadata: { guest_id: guest.id, night_id: night.id },
      },
      // Everything the webhook needs, so it never has to guess.
      metadata: {
        purpose: 'event_spot',
        guest_id: guest.id,
        allocation_id: alloc.id,
        night_id: night.id,
        promoter_id: alloc.promoter_id,
        fee_bps: String(feeBps),
        settle: platformSettled ? 'platform' : 'connect',
      },
      // Same clock as the hold above — and never under Stripe's floor, which
      // it rejects outright rather than clamping.
      expires_at: Math.floor(
        (now + Math.max(HOLD_MINUTES, STRIPE_MIN_SESSION_MINUTES) * 60_000) / 1000),
      // Back to the invite page on the vercel.app host, NOT clubfuoco.com:
      // that page's "Open your ticket" button links to clubfuoco.com, and only
      // a tap across domains opens the app (Universal Link) without a prompt.
      success_url: `${RETURN_HOST}/i/${token}?paid=1&guest=${guest.id}`,
      cancel_url: `${RETURN_HOST}/i/${token}?cancelled=1`,
    })

    await sb.from('promoter_guests')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', guest.id)

    return ok({ url: session.url, guestId: guest.id, amountCents: amount, currency })
  } catch (e) {
    // Stripe refused. Release the hold immediately rather than leaving a spot
    // locked up by a checkout that will never exist.
    await sb.from('promoter_guests').delete().eq('id', guest.id)
    const message = e instanceof Error ? e.message : 'Checkout failed'
    console.error('[checkout] stripe rejected the session:', message)
    return err('Couldn’t start checkout. Please try again.', 502)
  }
}
