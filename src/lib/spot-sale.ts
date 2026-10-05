import { createServiceClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { stripe } from '@/lib/stripe'
import { payoutAccount, canCharge, syncAccount, feeBpsForVisibility, isPlatformSettled } from '@/lib/connect'
import type { PayoutAccount } from '@/lib/connect'
import { platformFeeCents } from '@/lib/platform-fee'
import { ladder, livePrice } from '@/lib/releases'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Selling one spot on a paid promoter night, up to the moment money is asked
// for. Shared by the two ways a guest pays:
//   - /checkout        → Stripe Checkout (web, and app builds up to 1.13)
//   - /payment-intent  → an unconfirmed PaymentIntent the app confirms with the
//                        native Apple Pay sheet (1.14+)
// Everything that can refuse the sale lives here, so neither path can sell a
// ticket the other would have refused.

/**
 * How long a spot is held while somebody is paying.
 *
 * THIRTY IS A FLOOR, NOT A PREFERENCE. Stripe refuses any Checkout Session
 * whose `expires_at` is less than 30 minutes out ("The `expires_at` timestamp
 * must be at least 30 minutes from Checkout Session creation"), and this value
 * sets both the hold and that expiry. At 15 every single paid checkout came
 * back 400 from Stripe and 502 from here — no ticket on the platform could be
 * bought at all. Do not lower it.
 *
 * The two clocks are deliberately the same number: a Stripe session that
 * outlives its hold is a session someone can still pay after the spot has been
 * given away. The sweeper adds its own 30-minute grace on top before it
 * releases anything, so a slow webhook still wins the race.
 */
export const HOLD_MINUTES = 30

export interface SpotSale {
  kind: 'held'
  sb: SB
  guestId: string
  allocationId: string
  promoterId: string
  night: { id: string; night_date: string }
  eventName: string
  heads: number
  amount: number
  currency: string
  fee: number
  feeBps: number
  platformSettled: boolean
  payout: PayoutAccount
  /** Hold expiry as epoch ms — the Checkout session uses the same clock. */
  now: number
}

export type SpotSaleResult =
  | SpotSale
  | { kind: 'alreadyPaid'; guestId: string }
  | { kind: 'refused'; message: string; status: number }

function fail(message: string, status = 400): SpotSaleResult {
  return { kind: 'refused', message, status }
}

/**
 * Validate a paid spot and write the PENDING hold that counts against capacity.
 * The caller attaches a payment to `guestId`, and must delete the hold if
 * Stripe refuses to create one.
 */
export async function openSpotHold(req: Request, token: string): Promise<SpotSaleResult> {
  const body = await req.json().catch(() => ({}))
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const plusOnes = Math.max(0, Math.min(10, Number(body.plus_ones) || 0))
  if (!fullName) return fail('Name is required', 400)

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
  if (!resolved) return fail('Invite not found', 404)

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
  if (!alloc) return fail('Invite not found', 404)

  const night = (Array.isArray(alloc.night) ? alloc.night[0] : alloc.night) as {
    id: string; title: string | null; night_date: string
    price_cents: number | null; currency: string | null
    location_name: string | null; visibility: string | null
    club: { name?: string } | null
  } | null
  if (!night) return fail('Invite not found', 404)

  // A priced night may sell in waves. The price charged is the LIVE release's,
  // never the column — the column goes stale the moment a wave sells out or its
  // date passes, because neither of those changes a row for a trigger to catch.
  const releases = await ladder(sb, night.id)
  const live = releases.find(r => r.active) ?? null
  const unitPrice = livePrice(releases, night.price_cents ?? 0)

  // Every wave spent, on a night that does have waves: selling at the flat
  // price here would charge whatever the last sync happened to leave behind.
  if (releases.length > 0 && !live) {
    return fail('Tickets for this event have sold out.', 409)
  }
  // A free night has no business here — the caller should use /claim, and
  // silently creating a €0 Checkout session would be a confusing dead end.
  if (unitPrice <= 0) return fail('This event is free — use the normal RSVP.', 409)

  // A named promoter whose sales land on OUR account — see
  // isPlatformSettled. None of the Connect checks below apply: there
  // is no destination account to verify and no promoter card to back refunds,
  // because both of those are ours.
  const platformSettled = await isPlatformSettled(sb, alloc.promoter_id)

  // The promoter must be able to receive money BEFORE a guest is asked for any.
  // Discovering this at the card form is the worst possible moment.
  let payout = await payoutAccount(sb, alloc.promoter_id)

  if (!platformSettled) {
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
      return fail('This event can’t take payments yet. Ask the promoter to finish their payout setup.', 409)
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
      return fail('This event can’t take payments yet. Ask the promoter to finish their payout setup.', 409)
    }
  }

  const guests = (alloc.promoter_guests ?? []) as {
    id: string; plus_ones: number; claimed_by_user: string | null
    payment_status: string | null; hold_expires_at: string | null
  }[]

  // Already paid → hand back the existing spot rather than selling a second one.
  if (buyerId) {
    const mine = guests.find(g => g.claimed_by_user === buyerId)
    if (mine && mine.payment_status === 'paid') {
      return { kind: 'alreadyPaid', guestId: mine.id }
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
  if (used + heads > alloc.spots) return fail('Not enough spots left', 409)

  const amount = unitPrice * heads
  // Public offer or private event — two different deals, two different rates.
  // On a platform-settled sale the whole amount is ours, so there is no fee.
  const feeBps = platformSettled ? 0 : feeBpsForVisibility(payout, night.visibility)
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
      // Which wave this spot came out of — this is what makes "sold per
      // release" a count of real rows rather than a counter that drifts.
      release_id: live?.id ?? null,
      hold_expires_at: new Date(now + HOLD_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .single()

  // 23514 = the capacity trigger; 23505 = one-claim-per-user. Both mean the
  // answer is no, and neither should read as a server fault.
  if (insertErr?.code === '23514') return fail('Not enough spots left', 409)
  if (insertErr?.code === '23505') return fail('You already have a spot on this list', 409)
  if (insertErr || !guest) return fail('Couldn’t start checkout', 500)

  const eventName = night.title || night.club?.name || night.location_name || 'Club Fuoco event'
  return {
    kind: 'held', sb, guestId: guest.id, allocationId: alloc.id, promoterId: alloc.promoter_id,
    night: { id: night.id, night_date: night.night_date }, eventName,
    heads, amount, currency, fee, feeBps, platformSettled, payout, now,
  }
}

/**
 * Stripe's answer to "was this hold paid?", for either kind of hold: a
 * Checkout session (web, app ≤1.13) or a bare PaymentIntent (native Apple Pay).
 * Throws when Stripe can't be reached — callers must then leave the row alone.
 */
export async function holdPaidOnStripe(row: {
  stripe_checkout_session_id?: string | null
  stripe_payment_intent_id?: string | null
}): Promise<{ paid: boolean; paymentIntentId: string | null }> {
  if (row.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id)
    return {
      paid: session.payment_status === 'paid',
      paymentIntentId: (session.payment_intent as string) ?? null,
    }
  }
  if (row.stripe_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id)
    // Read-only on purpose. A caller about to DELETE the hold must cancel the
    // intent first — see releaseUnpaidIntent.
    return { paid: pi.status === 'succeeded', paymentIntentId: pi.id }
  }
  return { paid: false, paymentIntentId: null }
}

/**
 * Before deleting an unpaid PaymentIntent hold, cancel the intent so it can
 * never succeed afterwards. Returns false if it turned out to be paid (or
 * Stripe could not be reached) — then the row must NOT be deleted.
 */
export async function releaseUnpaidIntent(paymentIntentId: string): Promise<boolean> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
  if (pi.status === 'succeeded') return false
  if (pi.status !== 'canceled') {
    const after = await stripe.paymentIntents.cancel(pi.id)
    return after.status === 'canceled'
  }
  return true
}
