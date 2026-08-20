import { createServiceClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'
import { payoutAccount, canCharge, syncAccount, feeBpsForVisibility } from '@/lib/connect'
import { platformFeeCents } from '@/lib/platform-fee'

// POST /api/promoter-invites/<token>/checkout   { full_name, plus_ones? }
//
// Buying a spot on a paid night. Returns a Stripe Checkout URL; the spot is
// only really theirs once the webhook says the money landed.
//
// The money never passes through us. `transfer_data.destination` sends it
// straight to the promoter's own Connect account and `application_fee_amount`
// keeps our cut — so there is no payout to run, no balance to reconcile, and no
// point at which a person at Club Fuoco has to do anything.

/** How long a spot is held while somebody is on the Stripe page. */
const HOLD_MINUTES = 15

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const plusOnes = Math.max(0, Math.min(10, Number(body.plus_ones) || 0))
  if (!fullName) return err('Name is required', 400)

  const sb = await createServiceClient()

  // Identify the buyer if they're signed in. Unlike a free claim this is not
  // optional-friendly in practice — an anonymous purchase leaves someone with a
  // receipt and no way back to their ticket — but it is not REQUIRED either,
  // because refusing the sale of a ticket someone is trying to buy is worse.
  let buyerId: string | null = null
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (bearer) {
    const { data } = await sb.auth.getUser(bearer)
    buyerId = data.user?.id ?? null
  }

  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  const { data: alloc } = await sb
    .from('promoter_allocations')
    .select(`
      id, spots, promoter_id,
      night:promoter_nights ( id, title, night_date, price_cents, currency, location_name,
                              visibility, club:clubs ( name ) ),
      promoter_guests ( id, plus_ones, claimed_by_user, payment_status, hold_expires_at )
    `)
    .eq('id', resolved.allocationId)
    .maybeSingle()
  if (!alloc) return err('Invite not found', 404)

  const night = (Array.isArray(alloc.night) ? alloc.night[0] : alloc.night) as {
    id: string; title: string | null; night_date: string
    price_cents: number | null; currency: string | null
    location_name: string | null; visibility: string | null
    club: { name?: string } | null
  } | null
  if (!night) return err('Invite not found', 404)

  const unitPrice = night.price_cents ?? 0
  // A free night has no business here — the caller should use /claim, and
  // silently creating a €0 Checkout session would be a confusing dead end.
  if (unitPrice <= 0) return err('This event is free — use the normal RSVP.', 409)

  // The promoter must be able to receive money BEFORE a guest is asked for any.
  // Discovering this at the card form is the worst possible moment.
  let payout = await payoutAccount(sb, alloc.promoter_id)

  // Ask STRIPE, not just our mirror.
  //
  // Our copy of charges_enabled is only as fresh as the last account.updated we
  // received — and a webhook is a wire that can be unsubscribed, misconfigured,
  // or silently failing signature verification, none of which is visible from
  // here. Depending on it to decide whether someone can be paid means a promoter
  // Stripe disabled last week still takes a guest's card and fails.
  //
  // One extra API call at the START of a checkout is cheap: this is a payment
  // flow, nobody notices 200ms, and being wrong costs a guest their night. The
  // webhook stays as the fast path that keeps the mirror warm for the UI; this
  // is the check that actually gates money.
  if (payout.stripe_account_id) {
    try {
      const fresh = await stripe.accounts.retrieve(payout.stripe_account_id)
      await syncAccount(sb, fresh)
      payout = await payoutAccount(sb, alloc.promoter_id)
    } catch (e) {
      // Stripe unreachable. Fall through on the mirror rather than refusing a
      // sale on our own outage — the charge itself would fail anyway if the
      // account really is disabled.
      console.warn('[checkout] could not re-verify the payout account:',
        e instanceof Error ? e.message : e)
    }
  }

  if (!canCharge(payout)) {
    return err('This event can’t take payments yet. Ask the promoter to finish their payout setup.', 409)
  }
  // A card on file is checked HERE too, not only when the price was set. Stripe
  // can disable an account, and a card expires, weeks after a night went on
  // sale — and the moment either lapses we would be selling a ticket whose
  // refunds and chargebacks have nowhere to land.
  const { data: billing } = await sb
    .from('promoter_billing_accounts')
    .select('card_verified')
    .eq('user_id', alloc.promoter_id)
    .maybeSingle()
  if (!(billing as { card_verified?: boolean } | null)?.card_verified) {
    return err('This event can’t take payments yet. Ask the promoter to finish their payout setup.', 409)
  }

  const guests = (alloc.promoter_guests ?? []) as {
    id: string; plus_ones: number; claimed_by_user: string | null
    payment_status: string | null; hold_expires_at: string | null
  }[]

  // Already paid → hand back the existing spot rather than selling a second one.
  if (buyerId) {
    const mine = guests.find(g => g.claimed_by_user === buyerId)
    if (mine && mine.payment_status === 'paid') {
      return ok({ alreadyPaid: true, guestId: mine.id })
    }
  }

  // Capacity, counting live holds. Expired holds are excluded here and swept
  // separately — a spot someone abandoned on the Stripe page must not keep the
  // next person out for the rest of the night.
  const now = Date.now()
  const used = guests.reduce((sum, g) => {
    const holdLive = g.payment_status !== 'pending'
      || (g.hold_expires_at ? new Date(g.hold_expires_at).getTime() > now : false)
    return holdLive ? sum + 1 + (g.plus_ones ?? 0) : sum
  }, 0)
  const heads = 1 + plusOnes
  if (used + heads > alloc.spots) return err('Not enough spots left', 409)

  const amount = unitPrice * heads
  // Public offer or private event — two different deals, two different rates.
  const feeBps = feeBpsForVisibility(payout, night.visibility)
  const fee = platformFeeCents(amount, feeBps)
  const currency = (night.currency || 'eur').toLowerCase()

  // The held row. It counts against capacity from this moment, which is the
  // point of a hold — but it carries no QR and no Wallet pass until paid.
  const { data: guest, error: insertErr } = await sb
    .from('promoter_guests')
    .insert({
      allocation_id: alloc.id,
      full_name: fullName,
      plus_ones: plusOnes,
      created_via_invite: true,
      claimed_by_user: buyerId,
      referral_id: resolved.referralId,
      payment_status: 'pending',
      amount_cents: amount,
      hold_expires_at: new Date(now + HOLD_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .single()

  // 23514 = the capacity trigger; 23505 = one-claim-per-user. Both mean the
  // answer is no, and neither should read as a server fault.
  if (insertErr?.code === '23514') return err('Not enough spots left', 409)
  if (insertErr?.code === '23505') return err('You already have a spot on this list', 409)
  if (insertErr || !guest) return err('Couldn’t start checkout', 500)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://clubfuoco.com'
  const eventName = night.title || night.club?.name || night.location_name || 'Club Fuoco event'

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
      },
      // Stripe expires the session on its own timetable; ours is shorter, and
      // the sweeper is what actually frees the spot.
      expires_at: Math.floor((now + HOLD_MINUTES * 60_000) / 1000),
      success_url: `${appUrl}/i/${token}?paid=1&guest=${guest.id}`,
      cancel_url: `${appUrl}/i/${token}?cancelled=1`,
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
