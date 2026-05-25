import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { randomUUID } from 'crypto'

// Add the authenticated user to a Rumbalist free guestlist for a club.
// Records a booking on the user's profile so it appears in the Tickets tab
// and a Wallet pass can be generated from the standard /api/bookings flow.
export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  if (!body.club_id) return err('club_id is required')

  const supabase = await createServiceClient()
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id:        user!.id,
      club_id:        String(body.club_id),
      booking_type:   'free_guestlist',
      party_size:     1,
      booking_date:   tomorrow,
      status:         'confirmed',
      unit_price:     0,
      total_amount:   0,
      platform_fee:   0,
      qr_code_token:  randomUUID(),
    })
    .select('*')
    .single()

  if (error) return err(error.message)
  return ok(data)
}
