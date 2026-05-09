import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'

// GET /api/guest-lists/[id] — public: list details with DJ & club
// GET /api/guest-lists/[id]?view=signups — admin: signups list
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view')

  if (view === 'signups') {
    const supabase = await createServiceClient()
    const { data, error } = await supabase
      .from('guest_list_signups')
      .select('id, full_name, party_size, email, phone, status, tier, checked_in, checked_in_at, created_at')
      .eq('guest_list_id', id)
      .order('created_at', { ascending: true })
    if (error) return err(error.message)
    return ok(data)
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('guest_lists')
    .select(`
      id, club_id, event_name, event_date, cutoff_time, capacity, signups_count,
      free_entry_label, is_active, tier, price_cents,
      clubs (id, name, neighborhood),
      dj_profiles (id, stage_name, avatar_url, genres, is_verified)
    `)
    .eq('id', id)
    .single()

  if (error) return err('Guest list not found')
  return ok(data)
}

// PATCH /api/guest-lists/[id] — update (activate/deactivate/edit)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('guest_lists')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}

// DELETE /api/guest-lists/[id]
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServiceClient()

  const { error } = await supabase.from('guest_lists').delete().eq('id', id)
  if (error) return err(error.message)
  return ok({ deleted: true })
}
