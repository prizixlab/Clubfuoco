import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireRole } from '@/lib/auth'

// POST /api/admin/bookings/:id/checkin
// Alternative to QR scan — manual check-in by booking ID
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response

  const supabase = await createServiceClient()

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, status, party_size, booking_type, clubs(name), users(full_name)')
    .eq('id', id)
    .single()

  if (fetchError || !booking) return err('Booking not found', 404)
  if (booking.status === 'cancelled') return err('Booking is cancelled', 400)
  if (booking.status === 'used')      return err('Already checked in', 409)

  const { data, error: updateError } = await supabase
    .from('bookings')
    .update({
      status:        'used',
      checked_in_at: new Date().toISOString(),
      checked_in_by: user!.id,
    })
    .eq('id', id)
    .select()
    .single()

  if (updateError) return err(updateError.message)
  return ok(data)
}
