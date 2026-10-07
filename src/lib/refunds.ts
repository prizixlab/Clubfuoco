import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// ── A refunded or disputed charge revokes entry ──────────────────────────────
//
// Called from the Stripe webhook (charge.refunded with a FULL refund, and
// charge.dispute.created). Whatever that charge paid for stops admitting:
//   • promoter_guests → payment_status 'refunded' / 'disputed' — the door, the
//     QR and the Wallet pass all refuse both (lib/door, door/admit, qr.svg,
//     the guest wallet route);
//   • bookings → 'cancelled', unless already 'used' (they came; a refund after
//     the night is a goodwill matter, not an entry question);
//   • ticket_orders → 'refunded' / 'disputed' (revenue already excludes them).
//
// Idempotent: Stripe retries, and setting the same status twice is a no-op.

export type Revocation = 'refunded' | 'disputed'

export async function revokeForCharge(sb: SB, charge: Stripe.Charge, why: Revocation): Promise<void> {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!pi) {
    console.warn('[refunds] charge without a payment intent', charge.id, why)
    return
  }

  // 'disputed' arrives with 20261005_booking_hardening.sql. Until that is
  // applied the CHECK refuses it — fall back to 'refunded', which revokes
  // entry just the same, rather than leave the spot admissible.
  let { error: gErr } = await sb.from('promoter_guests')
    .update({ payment_status: why, hold_expires_at: null })
    .eq('stripe_payment_intent_id', pi)
  if (gErr && why === 'disputed' && (gErr.code === '23514' || /check/i.test(gErr.message ?? ''))) {
    ;({ error: gErr } = await sb.from('promoter_guests')
      .update({ payment_status: 'refunded', hold_expires_at: null })
      .eq('stripe_payment_intent_id', pi))
  }
  if (gErr) console.error('[refunds] promoter_guests', pi, gErr.message)

  const { error: bErr } = await sb.from('bookings')
    .update({ status: 'cancelled' })
    .eq('stripe_payment_intent_id', pi)
    .in('status', ['pending', 'confirmed'])
  if (bErr) console.error('[refunds] bookings', pi, bErr.message)

  const { error: tErr } = await sb.from('ticket_orders')
    .update({ status: why })
    .eq('stripe_payment_intent', pi)
  if (tErr) console.error('[refunds] ticket_orders', pi, tErr.message)

  console.log('[refunds] revoked', why, pi)
}

/** Payment statuses that must never admit anyone. */
export const NON_ADMITTING_PAYMENT = new Set(['pending', 'refunded', 'disputed'])
