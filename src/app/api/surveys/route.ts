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

  // Get confirmed/used bookings in that window
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`id, booking_date, booking_type, clubs(id, name, cover_image_url)`)
    .eq('user_id', user!.id)
    .in('status', ['confirmed', 'used'])
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
  booking_id:   z.string().uuid(),
  rating:       z.number().int().min(1).max(5),
  drinks:       z.array(z.string()).min(1),
  vibe_rating:  z.number().int().min(1).max(5),
  crowd_rating: z.number().int().min(1).max(5),
  would_return: z.enum(['yes', 'maybe', 'no']),
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

  // Async taste profile recompute — don't block the response
  fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/me/taste-profile`, {
    method: 'POST',
    headers: { 'Cookie': `sb-access-token=${user!.id}` }, // service-level trigger
  }).catch(() => {})

  return NextResponse.json({ data }, { status: 201 })
}
