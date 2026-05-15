import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
  if (!parsed.success) return err(parsed.error.message, 400)

  const supabase = await createClient()

  // Verify the booking belongs to the user
  const { data: booking } = await supabase
    .from('bookings')
    .select('id')
    .eq('id', parsed.data.booking_id)
    .eq('user_id', user!.id)
    .single()

  if (!booking) return err('Booking not found', 404)

  const { data, error } = await supabase
    .from('booking_surveys')
    .insert({ ...parsed.data, user_id: user!.id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return err('Survey already submitted', 409)
    return err(error.message)
  }

  // ── Award Fiamme points ───────────────────────────────────────────────────
  // Awaited inline — a fire-and-forget block would be killed when the
  // serverless function freezes after the response is sent. Best-effort:
  // wrapped in try/catch so a points failure never fails the survey.
  try {
    const ledgerRows: { user_id: string; amount: number; type: string; description: string; booking_id: string }[] = []

    // +10 verified review (always)
    ledgerRows.push({
      user_id:     user!.id,
      amount:      10,
      type:        'review',
      description: 'Verified review',
      booking_id:  parsed.data.booking_id,
    })

    // +50 if this is the first review of this club by anyone
    const { data: bk } = await supabase
      .from('bookings')
      .select('club_id')
      .eq('id', parsed.data.booking_id)
      .single()

    if (bk?.club_id) {
      const { data: clubBookings } = await supabase
        .from('bookings')
        .select('id')
        .eq('club_id', bk.club_id)

      const clubBookingIds = (clubBookings ?? [])
        .map(b => b.id)
        .filter(id => id !== parsed.data.booking_id)

      let isFirst = clubBookingIds.length === 0
      if (clubBookingIds.length > 0) {
        const { count: priorCount } = await supabase
          .from('booking_surveys')
          .select('id', { count: 'exact', head: true })
          .in('booking_id', clubBookingIds)
        isFirst = (priorCount ?? 0) === 0
      }

      if (isFirst) {
        ledgerRows.push({
          user_id:     user!.id,
          amount:      50,
          type:        'first_review',
          description: 'First review at this venue',
          booking_id:  parsed.data.booking_id,
        })
      }
    }

    const { error: ledgerError } = await supabase.from('fiamme_ledger').insert(ledgerRows)
    if (ledgerError) console.error('Fiamme points award failed:', ledgerError.message)
  } catch (e) {
    console.error('Fiamme points award threw:', e)
  }

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
