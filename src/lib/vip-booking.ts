import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/server'
import { resolveBookingDate } from '@/lib/utils'
import { generateReferenceCode } from '@/lib/rumbalist-reference'
import { supplyingBrandId } from '@/lib/partner'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// ── Writing a paid VIP table ─────────────────────────────────────────────────
//
// Two callers, one row:
//   • /api/rumbalist/confirm-vip — the app, right after Apple Pay;
//   • the Stripe webhook (payment_intent.succeeded, source rumbalist_vip) —
//     the backstop when the app never gets that far (killed, offline, or the
//     confirm request failed). Before this, a guest charged by Apple Pay whose
//     confirm call failed had no booking and nothing ever made one.
//
// Idempotent on stripe_payment_intent_id: whoever is second gets the first
// one's row (unique index from 20261005_booking_hardening.sql; until that is
// applied, the read-before-insert below still covers the common case).
//
// Everything is taken from the intent's metadata, which create-vip-intent
// wrote after checking it — never from a request body.

export type VipBookingResult =
  | { ok: true; booking: Record<string, unknown>; created: boolean }
  | { ok: false; error: string; status: number }

/** Only for intents created before create-vip-intent recorded these. */
export interface VipFallback { bookingDate?: string; venueName?: string; productName?: string }

export async function writeVipBooking(
  sb: SB, intent: Stripe.PaymentIntent, fallback: VipFallback = {},
): Promise<VipBookingResult> {
  const m = intent.metadata ?? {}
  if (intent.status !== 'succeeded') return { ok: false, error: `Payment not completed (status: ${intent.status})`, status: 402 }
  if (m.source !== 'rumbalist_vip' || !m.user_id || !m.club_id) {
    return { ok: false, error: 'Not a VIP table payment', status: 400 }
  }

  const existing = await byIntent(sb, intent.id)
  if (existing) return { ok: true, booking: existing, created: false }

  // A night create-vip-intent didn't record (an intent from before that
  // existed) falls back to the old default; resolveBookingDate then decides.
  const bookingDate = resolveBookingDate(m.booking_date ?? fallback.bookingDate)
  if (!bookingDate) return { ok: false, error: 'booking_date must be today or within the next 14 days', status: 400 }

  const total = intent.amount / 100   // cents → euros
  const brandId = await supplyingBrandId(sb, m.club_id, 'vip_table', bookingDate)

  let booking: Record<string, unknown> | null = null
  let insertErr: { code?: string; message?: string } | null = null
  let withBrand = true
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await sb
      .from('bookings')
      .insert({
        user_id:                  m.user_id,
        club_id:                  m.club_id,
        booking_type:             'vip',
        party_size:               1,
        booking_date:             bookingDate,
        status:                   'confirmed',
        unit_price:               total,
        total_amount:             total,
        platform_fee:             0,
        stripe_payment_intent_id: intent.id,
        qr_code_token:            generateReferenceCode(),
        ...(withBrand && brandId ? { brand_id: brandId } : {}),
      })
      .select('*')
      .single()
    booking = res.data
    insertErr = res.error
    if (!insertErr) break
    // Attribution must never cost someone a table they just paid for.
    if (/brand_id/.test(insertErr.message ?? '') && withBrand) { withBrand = false; continue }
    if (insertErr.code === '23505') {
      // Lost the race to the other caller — theirs is the booking.
      const winner = await byIntent(sb, intent.id)
      if (winner) return { ok: true, booking: winner, created: false }
      continue   // a reference-code collision: roll a new one
    }
    break
  }
  if (insertErr || !booking) {
    console.error('[vip-booking] insert failed', intent.id, insertErr?.message)
    return { ok: false, error: 'Couldn’t save the booking', status: 500 }
  }

  // Rumbalist purchase audit row — non-fatal, so a missing audit table never
  // loses the user's paid booking.
  try {
    const { data: profile } = await sb
      .from('users').select('full_name, email, phone').eq('id', m.user_id).single()
    await sb.from('rumbalist_purchases').insert({
      user_id:                  m.user_id,
      full_name:                profile?.full_name ?? null,
      email:                    profile?.email ?? null,
      phone:                    profile?.phone ?? null,
      venue_id:                 m.club_id,
      venue_name:               m.venue_name || fallback.venueName || 'Unknown venue',
      product_name:             m.product_name || fallback.productName || 'VIP Table',
      product_kind:             'vip_table',
      price_eur:                total,
      event_date:               bookingDate,
      stripe_payment_intent_id: intent.id,
      booking_id:               booking.id,
    })
  } catch (auditErr) {
    console.error('rumbalist_purchases insert failed (non-fatal):', auditErr)
  }

  return { ok: true, booking, created: true }
}

async function byIntent(sb: SB, intentId: string): Promise<Record<string, unknown> | null> {
  const { data } = await sb.from('bookings').select('*').eq('stripe_payment_intent_id', intentId).maybeSingle()
  return data ?? null
}
