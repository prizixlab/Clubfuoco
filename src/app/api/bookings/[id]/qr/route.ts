import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { generateQRCodeDataURL } from '@/lib/qr'

// GET /api/bookings/:id/qr — returns base64 QR PNG for the ticket screen
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('qr_code_token, status')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single()

  if (error || !booking) return err('Booking not found', 404)
  if (booking.status === 'cancelled') return err('Booking is cancelled', 400)

  const qrDataUrl = await generateQRCodeDataURL(booking.qr_code_token)
  return ok({ qr_data_url: qrDataUrl, token: booking.qr_code_token })
}
