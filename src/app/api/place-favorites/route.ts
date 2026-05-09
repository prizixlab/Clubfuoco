import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'

// GET — list saved places
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('place_favorites')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok(data ?? [])
}

// POST — save a place
// Body: { place_id, name, address, cover_photo, rating }
export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const { place_id, name, address, cover_photo, rating } = await req.json()
  if (!place_id || !name) return err('place_id and name required')
  const supabase = await createClient()
  const { error } = await supabase
    .from('place_favorites')
    .upsert({ user_id: user!.id, place_id, name, address, cover_photo, rating }, { onConflict: 'user_id,place_id' })
  if (error) return err(error.message)
  return ok({ saved: true })
}

// DELETE — unsave a place
// Body: { place_id }
export async function DELETE(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const { place_id } = await req.json()
  if (!place_id) return err('place_id required')
  const supabase = await createClient()
  const { error } = await supabase
    .from('place_favorites')
    .delete()
    .eq('user_id', user!.id)
    .eq('place_id', place_id)
  if (error) return err(error.message)
  return ok({ removed: true })
}
