import { createClient } from '@/lib/supabase/server'
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

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bookings')
    .select(`*, clubs(id, name, cover_image_url, address, neighborhood)`)
    .eq('id', id)
    .eq('user_id', user!.id) // users can only see their own
    .single()

  if (error || !data) return err('Booking not found', 404)
  return ok(data)
}

// DELETE /api/bookings/:id — cancel + partial refund (we keep the 10% platform fee)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, status, stripe_payment_intent_id, total_amount, platform_fee, booking_date')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single()

  if (fetchError || !booking) return err('Booking not found', 404)
  if (booking.status === 'used')      return err('Cannot cancel a used booking', 400)
  if (booking.status === 'cancelled') return err('Booking is already cancelled', 400)

  // Refund cutoff: no cancellations after 22:59 on the event night
  // (1 hour before 23:59 on booking_date, in Europe/Madrid time)
  const eventDate = new Date(booking.booking_date)
  // Build cutoff: 22:59:00 local Madrid time on the booking date
  const cutoffStr = `${booking.booking_date}T22:59:00`
  const cutoff = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(eventDate) + 'T22:59:00'
  )
  // Simpler: construct the cutoff as a UTC timestamp from the Madrid date
  const nowMadrid = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })
  )
  // Parse the booking_date in Madrid time
  const [year, month, day] = booking.booking_date.split('-').map(Number)
  const cutoffMadrid = new Date(year, month - 1, day, 22, 59, 0)

  if (nowMadrid >= cutoffMadrid) {
    return err('Cancellations are not allowed within 1 hour of midnight on the event night', 400)
  }

  // Partial refund — we keep the platform_fee (our 10%), refund the rest
  let refundError: string | null = null
  if (booking.stripe_payment_intent_id) {
    const refundAmountCents = Math.round(
      ((booking.total_amount ?? 0) - (booking.platform_fee ?? 0)) * 100
    )
    if (refundAmountCents > 0) {
      try {
        await stripe.refunds.create({
          payment_intent: booking.stripe_payment_intent_id,
          amount: refundAmountCents,
        })
      } catch (stripeErr: any) {
        // Log but don't block — still cancel the booking so the user isn't stuck
        refundError = stripeErr.message
        console.error('Stripe refund error (booking still cancelled):', stripeErr.message)
      }
    }
  }

  // Always mark as cancelled in DB regardless of Stripe outcome
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (updateError) return err(updateError.message)

  const refundAmount = ((booking.total_amount ?? 0) - (booking.platform_fee ?? 0)).toFixed(2)
  return ok({ cancelled: true, refund_amount: refundAmount, refund_note: refundError ? 'Refund will be processed manually' : null })
}
