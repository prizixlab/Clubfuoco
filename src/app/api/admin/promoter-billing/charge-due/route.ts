import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { offerLiveOn } from '@/lib/valid-days'
import { sendPushToUser } from '@/lib/push'
import { ok, err } from '@/lib/utils'

/**
 * Billing job for featured (front-page) promotions. Runs on a cron (protected
 * by CRON_SECRET, same as the other admin jobs).
 *
 * For each featured night whose billing window has closed (midnight of the
 * event + 7 days), we:
 *   1. count accepted headcount across the night's allocations (1 + plus_ones),
 *   2. compute amount = headcount × €0.30,
 *   3. charge the promoter's saved card OFF-SESSION.
 * On success → charge row 'charged'. On failure (or no card) → 'failed', the
 * promoter's balance goes negative by that amount and the account is gated
 * 'past_due' until they settle. No card can be force-charged — this is the
 * debt-ledger + access-lock model.
 *
 * SAFETY: test in Stripe TEST mode before pointing at live keys. Idempotent —
 * one charge row per night (UNIQUE night_id), never re-charges a 'charged' row.
 */
const RATE_CENTS = 30

// Vercel cron invokes via GET with the CRON_SECRET bearer.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!(cronSecret && authHeader === `Bearer ${cronSecret}`)) {
    return err('Unauthorized', 401)
  }

  const sb = await createServiceClient()
  const nowIso = new Date().toISOString()

  // Featured nights whose due window has passed and that don't yet have a
  // settled charge. due window = (event date 00:00) + 7 days.
  const cutoffDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const { data: nights } = await sb
    .from('promoter_nights')
    .select(`
      id, night_date,
      allocations:promoter_allocations (
        promoter_id,
        guests:promoter_guests ( plus_ones )
      )
    `)
    .eq('featured', true)
    .lte('night_date', cutoffDate)

  const results: Array<{ night: string; status: string; amount?: number }> = []

  for (const night of nights ?? []) {
    // Skip if already settled/attempted-charged.
    const { data: existing } = await sb
      .from('promoter_billing_charges')
      .select('id, status')
      .eq('night_id', night.id)
      .maybeSingle()
    if (existing && (existing.status === 'charged' || existing.status === 'waived')) {
      continue
    }

    const allocs = (night.allocations ?? []) as Array<{
      promoter_id: string
      guests: Array<{ plus_ones: number }>
    }>
    const promoterId = allocs[0]?.promoter_id
    if (!promoterId) continue

    const headcount = allocs.reduce(
      (s, a) => s + (a.guests ?? []).reduce((g, x) => g + 1 + (x.plus_ones ?? 0), 0), 0)
    const amount = headcount * RATE_CENTS

    const dueAt = new Date(new Date(night.night_date + 'T00:00:00').getTime() + 7 * 24 * 3600 * 1000).toISOString()

    if (amount <= 0) {
      await sb.from('promoter_billing_charges').upsert({
        night_id: night.id, promoter_id: promoterId, event_date: night.night_date,
        accepted_count: 0, amount_cents: 0, rate_cents: RATE_CENTS, due_at: dueAt,
        status: 'waived', charged_at: nowIso,
      }, { onConflict: 'night_id' })
      results.push({ night: night.id, status: 'waived' })
      continue
    }

    const { data: acct } = await sb
      .from('promoter_billing_accounts')
      .select('stripe_customer_id, default_payment_method_id, balance_cents')
      .eq('user_id', promoterId)
      .maybeSingle()

    // No card on file → record debt + gate.
    if (!acct?.stripe_customer_id || !acct?.default_payment_method_id) {
      await recordFailure(sb, night, promoterId, headcount, amount, dueAt, 'no_card_on_file', acct?.balance_cents ?? 0)
      results.push({ night: night.id, status: 'failed_no_card', amount })
      continue
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount, currency: 'eur',
        customer: acct.stripe_customer_id,
        payment_method: acct.default_payment_method_id,
        off_session: true,
        confirm: true,
        description: `Fuoco front-page promotion — ${headcount} guests × €0.30`,
        metadata: { promoter_id: promoterId, night_id: night.id },
      })
      await sb.from('promoter_billing_charges').upsert({
        night_id: night.id, promoter_id: promoterId, event_date: night.night_date,
        accepted_count: headcount, amount_cents: amount, rate_cents: RATE_CENTS, due_at: dueAt,
        status: 'charged', stripe_payment_intent_id: pi.id, attempts: (existing as any)?.attempts ?? 1,
        charged_at: nowIso,
      }, { onConflict: 'night_id' })
      results.push({ night: night.id, status: 'charged', amount })
    } catch (e: any) {
      await recordFailure(sb, night, promoterId, headcount, amount, dueAt, e?.code ?? 'charge_failed', acct.balance_cents ?? 0)
      results.push({ night: night.id, status: 'failed', amount })
    }
  }

  // Featured PUBLIC offers are billed the same way, but per night they ran
  // (they're continuous, not a single dated event).
  const offerResults = await chargeFeaturedOffers(sb, nowIso)

  return ok({ processed: results.length + offerResults.length, results, offers: offerResults })
}

// ── Featured public offers ───────────────────────────────────────────────────
// A featured offer runs every valid night with no end date, so it's billed per
// night: for each night whose 7-day window has just closed and on which the
// offer was live, count the guests who booked at its venue+kind, charge €0.30
// each. One charge row per (offer, night) — idempotent via the unique index.
//
// Attribution note: rumbalist_purchases carries no offer/brand link in the live
// schema, so headcount is matched by venue + date + product_kind (same as the
// supplier Guests screen). A brand that features two offers of the SAME kind at
// one venue on one night would double-count — not a real configuration.
async function chargeFeaturedOffers(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  nowIso: string,
): Promise<Array<{ offer: string; date: string; status: string; amount?: number }>> {
  const out: Array<{ offer: string; date: string; status: string; amount?: number }> = []

  const { data: offers } = await sb
    .from('partner_offers')
    .select('id, brand_id, club_id, kind, valid_days, skipped_dates, featured')
    .eq('featured', true)
  if (!offers?.length) return out

  // brand_id → owner user id (the account whose card is charged).
  const brandIds = [...new Set(offers.map(o => (o as { brand_id: string }).brand_id))]
  const { data: brands } = await sb
    .from('partner_brands').select('id, owner_user_id').in('id', brandIds)
  const ownerByBrand = new Map<string, string | null>(
    (brands ?? []).map(b => [(b as { id: string }).id, (b as { owner_user_id: string | null }).owner_user_id]))

  // Nights whose 7-day window closed in the last week (catch-up if the cron
  // missed a day). Oldest first so charges land in date order.
  const windowDates: string[] = []
  for (let d = 13; d >= 7; d--) {
    windowDates.push(new Date(Date.now() - d * 24 * 3600 * 1000).toISOString().slice(0, 10))
  }

  for (const o of offers) {
    const offer = o as {
      id: string; brand_id: string; club_id: string; kind: string
      valid_days: string; skipped_dates: string[] | null
    }
    const promoterId = ownerByBrand.get(offer.brand_id) ?? null
    if (!promoterId) continue   // unowned brand (operator-run) — nothing to bill

    for (const date of windowDates) {
      if (!offerLiveOn({ valid_days: offer.valid_days, skipped_dates: offer.skipped_dates ?? [] }, date)) continue

      const { data: existing } = await sb
        .from('partner_offer_billing_charges')
        .select('id, status').eq('offer_id', offer.id).eq('event_date', date).maybeSingle()
      if (existing && ['charged', 'waived'].includes((existing as { status: string }).status)) continue

      // Accepted guests at this venue+kind on this night.
      const { data: purchases } = await sb
        .from('rumbalist_purchases')
        .select('id, booking:bookings ( party_size )')
        .eq('venue_id', offer.club_id)
        .eq('event_date', date)
        .eq('product_kind', offer.kind)
      const headcount = (purchases ?? []).reduce(
        (s, p) => s + ((p as { booking?: { party_size?: number } | null }).booking?.party_size ?? 1), 0)
      const amount = headcount * RATE_CENTS
      const dueAt = new Date(new Date(date + 'T00:00:00').getTime() + 7 * 24 * 3600 * 1000).toISOString()

      if (amount <= 0) {
        await sb.from('partner_offer_billing_charges').upsert({
          offer_id: offer.id, brand_id: offer.brand_id, promoter_id: promoterId, event_date: date,
          accepted_count: 0, amount_cents: 0, rate_cents: RATE_CENTS, due_at: dueAt,
          status: 'waived', charged_at: nowIso,
        }, { onConflict: 'offer_id,event_date' })
        out.push({ offer: offer.id, date, status: 'waived' })
        continue
      }

      const { data: acct } = await sb
        .from('promoter_billing_accounts')
        .select('stripe_customer_id, default_payment_method_id, balance_cents')
        .eq('user_id', promoterId).maybeSingle()

      if (!acct?.stripe_customer_id || !acct?.default_payment_method_id) {
        await recordOfferFailure(sb, offer.id, offer.brand_id, promoterId, date, headcount, amount, dueAt, 'no_card_on_file', acct?.balance_cents ?? 0)
        out.push({ offer: offer.id, date, status: 'failed_no_card', amount })
        continue
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount, currency: 'eur',
          customer: acct.stripe_customer_id,
          payment_method: acct.default_payment_method_id,
          off_session: true, confirm: true,
          description: `Fuoco front-screen offer — ${headcount} guests × €0.30 (${date})`,
          metadata: { promoter_id: promoterId, offer_id: offer.id, event_date: date },
        })
        await sb.from('partner_offer_billing_charges').upsert({
          offer_id: offer.id, brand_id: offer.brand_id, promoter_id: promoterId, event_date: date,
          accepted_count: headcount, amount_cents: amount, rate_cents: RATE_CENTS, due_at: dueAt,
          status: 'charged', charged_at: nowIso,
        }, { onConflict: 'offer_id,event_date' })
        out.push({ offer: offer.id, date, status: 'charged', amount })
      } catch (e) {
        await recordOfferFailure(sb, offer.id, offer.brand_id, promoterId, date, headcount, amount, dueAt,
          (e as { code?: string })?.code ?? 'charge_failed', acct.balance_cents ?? 0)
        out.push({ offer: offer.id, date, status: 'failed', amount })
      }
    }
  }
  return out
}

async function recordOfferFailure(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  offerId: string, brandId: string, promoterId: string, date: string,
  headcount: number, amount: number, dueAt: string, reason: string, prevBalance: number,
) {
  await sb.from('partner_offer_billing_charges').upsert({
    offer_id: offerId, brand_id: brandId, promoter_id: promoterId, event_date: date,
    accepted_count: headcount, amount_cents: amount, rate_cents: RATE_CENTS, due_at: dueAt,
    status: 'failed',
  }, { onConflict: 'offer_id,event_date' })
  await sb.from('promoter_billing_accounts').upsert({
    user_id: promoterId, balance_cents: prevBalance - amount, status: 'past_due',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
}

async function recordFailure(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  night: { id: string; night_date: string }, promoterId: string,
  headcount: number, amount: number, dueAt: string, reason: string, prevBalance: number
) {
  // Was the account already gated? We only notify on the transition INTO
  // past_due, so a run that fails several nights doesn't fire a push per night.
  const { data: prev } = await sb
    .from('promoter_billing_accounts')
    .select('status')
    .eq('user_id', promoterId)
    .maybeSingle()
  const wasActive = ((prev as { status?: string } | null)?.status ?? 'active') === 'active'

  await sb.from('promoter_billing_charges').upsert({
    night_id: night.id, promoter_id: promoterId, event_date: night.night_date,
    accepted_count: headcount, amount_cents: amount, rate_cents: RATE_CENTS, due_at: dueAt,
    status: 'failed', last_error: reason,
  }, { onConflict: 'night_id' })
  // Balance goes negative; account gated until settled.
  await sb.from('promoter_billing_accounts').upsert({
    user_id: promoterId,
    balance_cents: prevBalance - amount,
    status: 'past_due',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  // Tell the promoter their card needs attention — otherwise they'd only find
  // out by opening the billing screen. Fire-and-forget; never blocks billing.
  if (wasActive) {
    await sendPushToUser(sb, promoterId, {
      title: 'Payment needs attention',
      body: reason === 'no_card_on_file'
        ? 'Add a card to pay for front-page promotion. Your nights and guest lists are unaffected.'
        : 'A front-page promotion charge didn’t go through. Update your card to resume promotion — your nights and guest lists are unaffected.',
    }, 'promoters')
  }
}
