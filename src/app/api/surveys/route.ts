import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { z } from 'zod'

// GET /api/surveys — bookings from the last 7 days that haven't been surveyed
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  // Window: yesterday up to 7 days ago (give them a week to respond)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const yStr = yesterday.toISOString().slice(0, 10)
  const wStr = weekAgo.toISOString().slice(0, 10)

  // Get confirmed/used bookings in that window (exclude ones the user dismissed)
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`id, booking_date, booking_type, clubs(id, name, cover_image_url)`)
    .eq('user_id', user!.id)
    .in('status', ['confirmed', 'used'])
    .is('survey_dismissed_at', null)
    .lte('booking_date', yStr)
    .gte('booking_date', wStr)
    .order('booking_date', { ascending: false })

  if (error) return err(error.message)
  if (!bookings?.length) return ok([])

  // Filter out ones that already have a survey
  const ids = bookings.map(b => b.id)
  const { data: done } = await supabase
    .from('booking_surveys')
    .select('booking_id')
    .in('booking_id', ids)

  const doneSet = new Set((done ?? []).map(d => d.booking_id))
  const pending = bookings.filter(b => !doneSet.has(b.id))

  return ok(pending)
}

const surveySchema = z.object({
  booking_id:    z.string().uuid(),
  rating:        z.number().int().min(1).max(5),
  // drink categories selected (e.g. ['beer', 'cocktails'])
  drinks:        z.array(z.string()),
  // specific drinks per category: { beer: ['Estrella Damm'] }
  drink_kinds:   z.record(z.array(z.string())).optional().default({}),
  // per-drink star ratings: { 'Negroni': 4, 'Estrella Damm': 5 }
  drink_ratings: z.record(z.number().int().min(1).max(5)).optional().default({}),
  // free-text per category: { cocktails: 'their house signature' }
  drink_custom:  z.record(z.string()).optional().default({}),
  vibe_rating:   z.number().int().min(1).max(5),
  music_genres:  z.array(z.string()).optional().default([]),
  crowd_rating:  z.number().int().min(1).max(5),
  would_return:  z.enum(['yes', 'maybe', 'no']),
})

// POST /api/surveys — submit a survey
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await req.json()
  const parsed = surveySchema.safeParse(body)
  if (!parsed.success) {
    console.error('[surveys] validation failed:', JSON.stringify(parsed.error.flatten()))
    console.error('[surveys] received body:', JSON.stringify(body))
    return err(parsed.error.message, 400)
  }

  // Service client bypasses RLS. The user is already verified by
  // requireAuth() above, and the insert below is explicitly scoped to
  // user.id — so this is safe, and the survey insert can never be
  // silently blocked by an RLS policy on a native (cookie-less) request.
  const supabase = await createServiceClient()

  // Verify the booking belongs to the user. Split the lookup so the error
  // message tells us why ("not in DB" vs "wrong user") — without this, native
  // testing always reports the same 404 regardless of root cause.
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('id, user_id')
    .eq('id', parsed.data.booking_id)
    .maybeSingle()
  if (bookingErr) return err(bookingErr.message, 500)
  if (!booking) {
    return err(`Booking ${parsed.data.booking_id.slice(0, 8)} not found`, 404)
  }
  if (booking.user_id !== user!.id) {
    return err('This booking belongs to a different account', 403)
  }

  const { data, error } = await supabase
    .from('booking_surveys')
    .insert({ ...parsed.data, user_id: user!.id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return err('Survey already submitted', 409)
    return err(error.message)
  }

  // Fiamme points are awarded by a database trigger on booking_surveys
  // (trg_award_fiamme_for_review) — see supabase/migrations/fiamme_points.sql.
  // Doing it in the DB removes all the RLS / serverless-timing fragility of
  // awarding points from this route.

  // Async taste profile recompute — don't block the response
  fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/me/taste-profile`, {
    method: 'POST',
    headers: { 'Cookie': `sb-access-token=${user!.id}` }, // service-level trigger
  }).catch(() => {})

  return NextResponse.json({ data }, { status: 201 })
}

// DELETE /api/surveys?booking_id=… — permanently dismiss the survey prompt
// (swipe-to-dismiss on the bookings page). Sets survey_dismissed_at on the
// booking row. No data is lost; the user just won't be re-prompted.
export async function DELETE(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const bookingId = req.nextUrl.searchParams.get('booking_id')
  if (!bookingId) return err('booking_id required', 400)

  const supabase = await createClient()

  const { error } = await supabase
    .from('bookings')
    .update({ survey_dismissed_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('user_id', user!.id)        // RLS belt-and-braces — only own bookings

  if (error) return err(error.message)
  return ok({ dismissed: bookingId })
}
