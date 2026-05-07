import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireRole } from '@/lib/auth'

// POST /api/bookings/verify/:token
// Used by club staff to scan QR codes at the door
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Only club staff / admin can check in guests
  const { user, response } = await requireRole(['club_staff', 'club_owner', 'admin'])
  if (response) return response

  // Use service client to bypass RLS (staff checking other users' bookings)
  const supabase = await createServiceClient()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, status, party_size, booking_type, arrival_window,
      clubs (id, name),
      users (full_name, email)
    `)
    .eq('qr_code_token', token)
    .single()

  if (error || !booking) return err('Invalid QR code', 404)
  if (booking.status === 'cancelled') return err('Booking is cancelled', 400)
  if (booking.status === 'used')      return err('Already checked in', 409)

  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      status:        'used',
      checked_in_at: new Date().toISOString(),
      checked_in_by: user!.id,
    })
    .eq('id', booking.id)

  if (updateError) return err(updateError.message)

  return ok({
    checked_in: true,
    booking: {
      id:            booking.id,
      club_name:     (booking.clubs as any)?.name,
      guest_name:    (booking.users as any)?.full_name,
      party_size:    booking.party_size,
      booking_type:  booking.booking_type,
      arrival_window: booking.arrival_window,
    },
  })
}
