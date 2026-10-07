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
  /** The lead ticket — the row the payment is attached to. */
  guestId: string
  /** Every ticket this purchase makes, lead first. */
  ticketIds: string[]
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

/** Most tickets one purchase can make, the buyer's own included. */
export const MAX_TICKETS = 10

/**
 * Validate a paid spot and write the PENDING hold that counts against capacity.
 * The caller attaches a payment to `guestId`, and must delete the hold if
 * Stripe refuses to create one (deleting the lead deletes its companions).
 *
 * Body: { full_name, plus_ones?, guests?: [{ full_name }], for_others? }
 *   • guests     — extra NAMED tickets, each its own row and QR, linked to the
 *                  lead by `paid_with` (migration 20261007_multi_ticket_purchases)
 *   • for_others — buying only for other people ("buy another ticket" after
 *                  the buyer already has theirs); the first guest is the lead
 * Both need a signed-in buyer: the tickets are held on their account until
 * they send them on.
 */
export async function openSpotHold(req: Request, token: string): Promise<SpotSaleResult> {
  const body = await req.json().catch(() => ({}))
  const forOthers = body.for_others === true
  const extraNames: string[] = (Array.isArray(body.guests) ? body.guests : [])
    .map((g: unknown) => (g && typeof (g as { full_name?: unknown }).full_name === 'string'
      ? (g as { full_name: string }).full_name.trim() : ''))
  if (extraNames.some(n => !n)) return fail('Every ticket needs a name', 400)
  const fullName = forOthers ? (extraNames[0] ?? '')
    : typeof body.full_name === 'string' ? body.full_name.trim() : ''
  // Plus-ones ride on the buyer's own QR — not on a ticket bought for someone else.
  const plusOnes = forOthers ? 0 : Math.max(0, Math.min(10, Number(body.plus_ones) || 0))
  if (!fullName) return fail('Name is required', 400)
  // The lead's name is the first guest when buying for others; the rest are companions.
  const companionNames = forOthers ? extraNames.slice(1) : extraNames
  const ticketCount = 1 + companionNames.length
  if (ticketCount > MAX_TICKETS) return fail(`At most ${MAX_TICKETS} tickets at a time`, 400)
  const multi = forOthers || companionNames.length > 0

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
  if (multi && !buyerId) return fail('Sign in to buy tickets for other people.', 401)

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
  // Already HOLDING one (opened the payment page or Apple Pay sheet, backed
  // out, tapped Buy again) → release that hold and sell afresh below. The
  // one-claim-per-user index covers pending rows too, so this used to answer
  // "You already have a spot on this list" to someone who had paid nothing,
  // for the whole 30-minute hold.
  // Buying for others leaves the buyer's own spot alone, whatever its state.
  if (buyerId && !forOthers) {
    const mine = guests.find(g => g.claimed_by_user === buyerId)
    if (mine && mine.payment_status === 'paid') {
      return { kind: 'alreadyPaid', guestId: mine.id }
    }
    // Refunded or charged back: no longer a ticket, but still holding the
    // one-claim-per-user slot, so buying again would answer "You already have
    // a spot on this list". Let go of the claim; purchased_by_user keeps the
    // row attributed to the buyer for the record.
    if (mine && (mine.payment_status === 'refunded' || mine.payment_status === 'disputed')) {
      const { error: relErr } = await sb.from('promoter_guests')
        .update({ claimed_by_user: null, purchased_by_user: buyerId })
        .eq('id', mine.id).in('payment_status', ['refunded', 'disputed'])
      if (relErr) {
        console.error('[spot-sale] could not release a refunded claim:', relErr.message)
        return fail('Couldn’t start checkout', 500)
      }
      guests.splice(guests.indexOf(mine), 1)
    }
    if (mine && mine.payment_status === 'pending') {
      const { data: held } = await sb.from('promoter_guests')
        .select('stripe_checkout_session_id, stripe_payment_intent_id')
        .eq('id', mine.id).maybeSingle()
      const row = (held ?? {}) as { stripe_checkout_session_id?: string | null; stripe_payment_intent_id?: string | null }
      try {
        const { paid, paymentIntentId } = await holdPaidOnStripe(row)
        if (paid) {
          // Paid, the webhook just hasn't landed — record it now.
          await sb.from('promoter_guests').update({
            payment_status: 'paid', paid_at: new Date().toISOString(), hold_expires_at: null,
            stripe_payment_intent_id: paymentIntentId,
          }).eq('id', mine.id).neq('payment_status', 'paid')
          return { kind: 'alreadyPaid', guestId: mine.id }
        }
        // Make the abandoned attempt unpayable before its spot is let go.
        if (row.stripe_checkout_session_id) {
          await stripe.checkout.sessions.expire(row.stripe_checkout_session_id).catch(() => {})
        } else if (row.stripe_payment_intent_id
                   && !(await releaseUnpaidIntent(row.stripe_payment_intent_id))) {
          return fail('Your last payment is still going through. Check Tickets in a moment.', 409)
        }
      } catch (e) {
        console.warn('[checkout] could not read the held payment:', e instanceof Error ? e.message : e)
        return fail('Couldn’t reopen your checkout. Try again in a moment.', 502)
      }
      await sb.from('promoter_guests').delete().eq('id', mine.id).eq('payment_status', 'pending')
      guests.splice(guests.indexOf(mine), 1)
    }
  }

  // Capacity, counting live holds. Expired holds are excluded here and swept
  // separately — a spot someone abandoned on the Stripe page must not keep the
  // next person out for the rest of the night.
  const now = Date.now()
  const used = guests.reduce((sum, g) => {
    // Refunded and charged-back tickets admit nobody, so they hold no spot.
    if (g.payment_status === 'refunded' || g.payment_status === 'disputed') return sum
    const holdLive = g.payment_status !== 'pending'
      || (g.hold_expires_at ? new Date(g.hold_expires_at).getTime() > now : false)
    return holdLive ? sum + 1 + (g.plus_ones ?? 0) : sum
  }, 0)
  const leadHeads = 1 + plusOnes
  const heads = leadHeads + companionNames.length
  if (used + heads > alloc.spots) {
    return fail(ticketCount > 1 ? `Not enough spots left for ${ticketCount} tickets` : 'Not enough spots left', 409)
  }

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
      // A ticket bought for someone else belongs to nobody until it's sent on.
      claimed_by_user: forOthers ? null : buyerId,
      // Only written on multi-ticket purchases, so a single-ticket sale keeps
      // working on a database without the 20261007 migration.
      ...(multi ? { purchased_by_user: buyerId } : {}),
      referral_id: resolved.referralId,
      payment_status: 'pending',
      // Each row carries ITS share, so summing rows gives revenue; the charge
      // itself is `amount`, the whole purchase.
      amount_cents: unitPrice * leadHeads,
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

  // The other named tickets. Same hold, same wave; they follow the lead's
  // payment_status by trigger and vanish with it if the purchase is abandoned.
  const ticketIds = [guest.id as string]
  if (companionNames.length > 0) {
    const holdUntil = new Date(now + HOLD_MINUTES * 60_000).toISOString()
    const { data: companions, error: compErr } = await sb
      .from('promoter_guests')
      .insert(companionNames.map(name => ({
        allocation_id: alloc.id,
        full_name: name,
        plus_ones: 0,
        created_via_invite: true,
        claimed_by_user: null,
        purchased_by_user: buyerId,
        paid_with: guest.id,
        referral_id: resolved.referralId,
        payment_status: 'pending',
        amount_cents: unitPrice,
        release_id: live?.id ?? null,
        hold_expires_at: holdUntil,
      })))
      .select('id')
    if (compErr || !companions || companions.length !== companionNames.length) {
      await sb.from('promoter_guests').delete().eq('id', guest.id)
      if (compErr?.code === '23514') return fail(`Not enough spots left for ${ticketCount} tickets`, 409)
      console.error('[spot-sale] companion tickets:', compErr?.message)
      return fail('Couldn’t start checkout', 500)
    }
    ticketIds.push(...companions.map(c => c.id as string))
  }

  const eventName = night.title || night.club?.name || night.location_name || 'Club Fuoco event'
  return {
    kind: 'held', sb, guestId: guest.id, ticketIds, allocationId: alloc.id, promoterId: alloc.promoter_id,
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
