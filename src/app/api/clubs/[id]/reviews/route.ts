import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'

const reviewSchema = z.object({
  booking_id: z.string().uuid().optional(),
  rating:     z.number().int().min(1).max(5),
  body:       z.string().max(1000).optional(),
})

// GET /api/clubs/:id/reviews
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10'), 50)
  const from  = (page - 1) * limit
  const to    = from + limit - 1

  const { data, error } = await supabase
    .from('reviews')
    .select('*, users(full_name, avatar_url)')
    .eq('club_id', id)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return err(error.message)
  return ok(data)
}

// POST /api/clubs/:id/reviews
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const body   = await request.json()
  const parsed = reviewSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const supabase = await createClient()

  // If booking_id provided, verify it belongs to this user + club
  if (parsed.data.booking_id) {
    const { data: booking } = await supabase
      .from('bookings')
      .select('user_id, club_id, status')
      .eq('id', parsed.data.booking_id)
      .single()

    if (!booking || booking.user_id !== user!.id || booking.club_id !== id) {
      return err('Invalid booking reference', 400)
    }
    if (booking.status !== 'used') {
      return err('Can only review after attending', 400)
    }
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert({ user_id: user!.id, club_id: id, ...parsed.data })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
