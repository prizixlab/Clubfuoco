import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

const TOPICS = ['refused', 'qr', 'details', 'charge', 'queue', 'other'] as const
type Topic = (typeof TOPICS)[number]

// POST /api/support — intake from the consumer app's Help button.
//
// Authenticated: a support request is attributed to the guest who filed it, and
// the booking's context (venue, night) is read server-side rather than trusted
// from the client, so a report can't be filed against someone else's booking.
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  let body: { topic?: string; message?: string; booking_id?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }

  const topic = body.topic as Topic
  if (!TOPICS.includes(topic)) return err('Unknown topic', 400)

  const sb = await createServiceClient()

  // Resolve booking context ourselves, and only if it belongs to this user.
  let clubId: string | null = null
  let nightDate: string | null = null
  let bookingId: string | null = null
  if (body.booking_id) {
    const { data: bk } = await sb
      .from('bookings')
      .select('id, club_id, booking_date, user_id')
      .eq('id', body.booking_id)
      .maybeSingle()
    if (bk && bk.user_id === user!.id) {
      bookingId = bk.id
      clubId = bk.club_id
      nightDate = bk.booking_date
    }
  }

  const { data: profile } = await sb
    .from('users').select('email').eq('id', user!.id).maybeSingle()

  const { data, error } = await sb
    .from('support_requests')
    .insert({
      user_id: user!.id,
      booking_id: bookingId,
      club_id: clubId,
      night_date: nightDate,
      topic,
      message: (body.message ?? '').slice(0, 2000) || null,
      contact_email: profile?.email ?? null,
      app: 'clubfuoco',
    })
    .select('id, created_at')
    .single()

  // The table lands with a manual migration — until it's applied, don't fail the
  // guest's report with a database error they can't act on.
  if (error) return err('Support is unavailable right now. Please try again later.', 503)

  return ok({ id: data.id, created_at: data.created_at }, 201)
}
