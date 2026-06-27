import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
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

  return ok({ processed: results.length, results })
}

async function recordFailure(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
  night: { id: string; night_date: string }, promoterId: string,
  headcount: number, amount: number, dueAt: string, reason: string, prevBalance: number
) {
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
}
