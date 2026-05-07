import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

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
