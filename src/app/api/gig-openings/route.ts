import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

// GET — browse open gig postings (DJ side) or club's own openings (?mine=1)
export async function GET(request: NextRequest) {
  const mine = request.nextUrl.searchParams.get('mine') === '1'
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  if (mine) {
    const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
    if (!staff) return err('Not linked to a club')
    const { data, error } = await supabase
      .from('gig_openings')
      .select('*, clubs(name), gig_applications(id, status)')
      .eq('club_id', staff.club_id)
      .order('created_at', { ascending: false })
    if (error) return err(error.message)
    return ok(data)
  }

  const { data, error } = await supabase
    .from('gig_openings')
    .select('*, clubs(id, name, cover_image_url)')
    .eq('status', 'open')
    .order('event_date', { ascending: true })
  if (error) return err(error.message)
  return ok(data)
}

// POST — club creates a new opening
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')

  const { title, description, event_date, genres, pay_range } = await request.json()
  if (!title) return err('Title is required')

  const { data, error } = await supabase
    .from('gig_openings')
    .insert({ club_id: staff.club_id, title, description, event_date, genres, pay_range, status: 'open' })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
