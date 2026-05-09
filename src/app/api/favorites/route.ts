import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { NextRequest } from 'next/server'

// GET /api/favorites — user's saved clubs
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('favorites')
    .select(`
      clubs (
        id, name, slug, cover_image_url, neighborhood,
        general_entry_price, music_genres,
        live_status (crowd_label, is_open, current_dj, crowd_percentage)
      )
    `)
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  if (error) return err(error.message)
  return ok((data ?? []).map((f: any) => f.clubs).filter(Boolean))
}

// POST /api/favorites — save a club
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { club_id } = await request.json()
  if (!club_id) return err('club_id required')

  const supabase = await createClient()
  const { error } = await supabase
    .from('favorites')
    .upsert({ user_id: user!.id, club_id }, { onConflict: 'user_id,club_id' })

  if (error) return err(error.message)
  return ok({ saved: true })
}

// DELETE /api/favorites — remove a saved club
export async function DELETE(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { club_id } = await request.json()
  if (!club_id) return err('club_id required')

  const supabase = await createClient()
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', user!.id)
    .eq('club_id', club_id)

  if (error) return err(error.message)
  return ok({ removed: true })
}
