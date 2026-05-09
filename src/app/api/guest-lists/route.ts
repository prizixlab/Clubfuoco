import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// GET /api/guest-lists?club_id=xxx — get active guest lists for a club
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clubId = searchParams.get('club_id')
  const isAdmin = searchParams.get('admin') === '1'

  const supabase = await createClient()

  let query = supabase
    .from('guest_lists')
    .select('id, club_id, event_name, event_date, cutoff_time, capacity, signups_count, free_entry_label, is_active')
    .order('event_date', { ascending: false })

  if (!isAdmin) {
    query = query.eq('is_active', true).gte('event_date', new Date().toISOString().split('T')[0])
  }

  if (clubId) query = query.eq('club_id', clubId)

  const { data, error } = await query
  if (error) return err(error.message)
  return ok(data)
}

// POST /api/guest-lists — create a new guest list (admin only)
export async function POST(request: NextRequest) {
  const supabase = await createServiceClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('guest_lists')
    .insert({
      club_id: body.club_id,
      event_name: body.event_name,
      event_date: body.event_date,
      cutoff_time: body.cutoff_time ?? '01:00',
      capacity: body.capacity ?? 50,
      free_entry_label: body.free_entry_label ?? 'Free Entry Tonight',
      notes: body.notes,
      is_active: body.is_active ?? false,
    })
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data, 201)
}
