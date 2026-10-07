import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// ── A refunded or disputed charge revokes entry ──────────────────────────────
//
// Called from the Stripe webhook (charge.refunded with a FULL refund, and
// charge.dispute.created). Whatever that charge paid for stops admitting:
//   • promoter_guests → payment_status 'refunded' / 'disputed' — the door, the
//     QR, the Wallet pass and the Tickets list all refuse both
//     (NON_ADMITTING_PAYMENT below);
//   • bookings → 'cancelled', unless already 'used' (they came; a refund after
//     the night is a goodwill matter, not an entry question);
//   • ticket_orders → 'refunded' / 'disputed'.
//
// Before this, every reader checked for 'refunded' and nothing ever wrote it,
// so a refunded guest kept a valid QR and got in anyway.
//
// Idempotent: Stripe retries, and setting the same status twice is a no-op.

export type Revocation = 'refunded' | 'disputed'

/** Payment statuses that must never admit anyone. */
export const NON_ADMITTING_PAYMENT = new Set(['pending', 'refunded', 'disputed'])

/** The same set as a PostgREST `not.in.(…)` list. */
export const NON_ADMITTING_PAYMENT_LIST = `(${[...NON_ADMITTING_PAYMENT].join(',')})`

/**
 * Revoke what `charge` paid for. Returns false when an entry-granting row could
 * not be revoked, so the webhook answers 500 and Stripe retries — logging and
 * returning 200 would leave a refunded guest admissible for good.
 */
export async function revokeForCharge(sb: SB, charge: Stripe.Charge, why: Revocation): Promise<boolean> {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!pi) {
    console.warn('[refunds] charge without a payment intent', charge.id, why)
    return true
  }
  let ok = true

  // promoter_guests.payment_status is CHECK-constrained to
  // free/pending/paid/refunded (20260820_paid_events). Until a migration adds
  // 'disputed', the CHECK refuses it — fall back to 'refunded', which revokes
  // entry just the same, rather than leave the spot admissible.
  //
  // The charge paid for its lead row (which carries the intent id) AND any
  // companion tickets bought with it (paid_with → lead) — the whole charge is
  // gone, so every ticket it bought goes. Companions don't follow a lead's
  // refund by trigger any more: a guest may refund one ticket on its own.
  const { data: leads, error: lErr } = await sb.from('promoter_guests')
    .select('id').eq('stripe_payment_intent_id', pi)
  if (lErr) { console.error('[refunds] promoter_guests lookup', pi, lErr.message); ok = false }
  const ids = (leads ?? []).map(r => (r as { id: string }).id)
  if (ids.length > 0) {
    const scope = `id.in.(${ids.join(',')}),paid_with.in.(${ids.join(',')})`
    const revoke = (status: string) => sb.from('promoter_guests')
      .update({ payment_status: status, hold_expires_at: null })
      .or(scope)
      .in('payment_status', ['paid', 'pending', 'refunded', 'disputed'])
    let { error: gErr } = await revoke(why)
    if (gErr && why === 'disputed' && (gErr.code === '23514' || /check/i.test(gErr.message ?? ''))) {
      ;({ error: gErr } = await revoke('refunded'))
    }
    if (gErr) { console.error('[refunds] promoter_guests', pi, gErr.message); ok = false }
  }

  const { error: bErr } = await sb.from('bookings')
    .update({ status: 'cancelled' })
    .eq('stripe_payment_intent_id', pi)
    .in('status', ['pending', 'confirmed'])
  if (bErr) { console.error('[refunds] bookings', pi, bErr.message); ok = false }

  // Bookkeeping only — ticket_orders carry no door QR, so a failure here is
  // logged and does not hold up the webhook.
  const { error: tErr } = await sb.from('ticket_orders')
    .update({ status: why })
    .eq('stripe_payment_intent', pi)
  if (tErr) console.error('[refunds] ticket_orders', pi, tErr.message)

  console.log('[refunds] revoked', why, pi, ok ? '' : '(with errors)')
  return ok
}
