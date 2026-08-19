import { createServiceClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { ok, err } from '@/lib/utils'

// Clearing checkout holds nobody finished.
//
// A 'pending' row holds a spot from the moment checkout opens. Capacity maths
// already ignores holds past their expiry, so an abandoned checkout never
// blocks a buyer — but the rows still sit in promoter_guests forever, and every
// query that counts guests has to know to skip them. This deletes them.
//
// THE RISK THIS GUARDS AGAINST: deleting a hold that was actually paid. A
// webhook can arrive late — Stripe retries for hours — so "expired" is not the
// same as "unpaid". Every candidate is re-checked against Stripe before it is
// touched, and anything Stripe says was paid is marked paid instead of deleted.
// Losing a paid spot is unrecoverable for the guest; leaving a stale row is not.
//
// Cron: hourly. Also runnable by an admin.

/** Grace on top of the hold, so a slow webhook always wins the race. */
const GRACE_MINUTES = 30

export async function GET(req: Request) {
  // Vercel cron carries a bearer; otherwise require the admin secret.
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) return err('Unauthorized', 401)

  const sb = await createServiceClient()
  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000).toISOString()

  const { data: stale, error } = await sb
    .from('promoter_guests')
    .select('id, stripe_checkout_session_id, hold_expires_at')
    .eq('payment_status', 'pending')
    .lt('hold_expires_at', cutoff)
    .limit(200)

  if (error) return err(error.message, 500)
  if (!stale?.length) return ok({ checked: 0, released: 0, rescued: 0 })

  let released = 0
  let rescued = 0

  for (const row of stale) {
    // No session id means checkout never got off the ground — nothing to ask
    // Stripe about, and nothing that could have been paid.
    if (!row.stripe_checkout_session_id) {
      const { error: delErr } = await sb.from('promoter_guests')
        .delete().eq('id', row.id).eq('payment_status', 'pending')
      if (!delErr) released++
      continue
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id)
      if (session.payment_status === 'paid') {
        // The webhook never landed, or landed and failed. Honour the money.
        const { error: payErr } = await sb.from('promoter_guests')
          .update({
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
            hold_expires_at: null,
            stripe_payment_intent_id: (session.payment_intent as string) ?? null,
          })
          .eq('id', row.id)
          .neq('payment_status', 'paid')
        if (!payErr) rescued++
        continue
      }
    } catch (e) {
      // Couldn't ask Stripe. Leave the row alone — it costs nothing to keep,
      // and deleting on incomplete information is how a paid spot disappears.
      console.warn('[sweep-holds] could not verify', row.id,
        e instanceof Error ? e.message : e)
      continue
    }

    const { error: delErr } = await sb.from('promoter_guests')
      .delete().eq('id', row.id).eq('payment_status', 'pending')
    if (!delErr) released++
  }

  return ok({ checked: stale.length, released, rescued })
}
