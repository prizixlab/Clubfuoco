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

// DELETE /api/bookings/:id — cancel + refund
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
    .select('id, status, stripe_payment_intent_id, total_amount, booking_date')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single()

  if (fetchError || !booking) return err('Booking not found', 404)
  if (booking.status === 'used')      return err('Cannot cancel a used booking', 400)
  if (booking.status === 'cancelled') return err('Booking is already cancelled', 400)

  // Issue Stripe refund
  if (booking.stripe_payment_intent_id) {
    try {
      await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
      })
    } catch (stripeErr: any) {
      return err(`Refund failed: ${stripeErr.message}`, 500)
    }
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (updateError) return err(updateError.message)
  return ok({ cancelled: true })
}
