import { createAuthedClient, createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'

// GET /api/bookings/:id
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createAuthedClient()

  const { data, error } = await supabase
    .from('bookings')
    .select(`*, clubs(id, name, cover_image_url, address, neighborhood)`)
    .eq('id', id)
    .eq('user_id', user!.id) // users can only see their own
    .single()

  if (error || !data) return err('Booking not found', 404)
  return ok(data)
}

// DELETE /api/bookings/:id — cancel a booking.
//   • Free bookings cancel cleanly, no refund, no time restriction.
//   • Paid bookings refund everything the guest paid EXCEPT the payment-
//     processing fee Stripe charged us on the original charge (which Stripe
//     keeps on refunds), so a cancellation never costs us money.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createAuthedClient()

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, status, stripe_payment_intent_id, total_amount, platform_fee, booking_date')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single()

  if (fetchError || !booking) return err('Booking not found', 404)
  if (booking.status === 'used')      return err('Cannot cancel a used booking', 400)
  if (booking.status === 'cancelled') return err('Booking is already cancelled', 400)

  const totalCents = Math.round((booking.total_amount ?? 0) * 100)
  const isFree = !booking.stripe_payment_intent_id || totalCents <= 0

  let refundAmountEuros = 0
  let refundError: string | null = null

  if (!isFree) {
    // The non-recoverable cost = the processing fee Stripe took on the original
    // payment. Pull the actual fee from the charge's balance transaction; if
    // that lookup fails, fall back to Stripe's standard EU card fee (1.5% + €0.25).
    let feeCents = Math.round(totalCents * 0.015) + 25
    try {
      const intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id!, {
        expand: ['latest_charge.balance_transaction'],
      })
      const charge = intent.latest_charge as any
      const actualFee = charge?.balance_transaction?.fee
      if (typeof actualFee === 'number') feeCents = actualFee
    } catch (feeErr: any) {
      console.error('Could not read Stripe fee, using estimate:', feeErr.message)
    }

    const refundCents = Math.max(0, totalCents - feeCents)
    refundAmountEuros = refundCents / 100

    if (refundCents > 0) {
      try {
        await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id!,
          amount: refundCents,
        })
      } catch (stripeErr: any) {
        // Log but don't block — still cancel the booking so the user isn't stuck
        refundError = stripeErr.message
        console.error('Stripe refund error (booking still cancelled):', stripeErr.message)
      }
    }
  }

  // Always mark as cancelled in DB regardless of Stripe outcome.
  //
  // Ownership was already verified above via the authed client. Guests have no
  // UPDATE policy on bookings (the only one is "Staff can update booking status",
  // and staff/admin accounts were removed by design), so the authed client's
  // update is silently filtered by RLS — 0 rows changed, no error — and the
  // cancel appears to succeed while nothing happens. Perform the status change
  // with the service client (bypasses RLS) and confirm a row actually changed.
  const admin = await createServiceClient()
  const { data: updated, error: updateError } = await admin
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('user_id', user!.id)
    .select('id')

  if (updateError) return err(updateError.message)
  if (!updated || updated.length === 0) return err('Cancellation failed — booking not updated', 500)

  return ok({
    cancelled:     true,
    refund_amount: refundAmountEuros.toFixed(2),
    refund_note:   refundError ? 'Refund will be processed manually' : null,
  })
}
