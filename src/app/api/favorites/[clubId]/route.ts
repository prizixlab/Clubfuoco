import { createClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

// POST /api/favorites/:clubId — save a club
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { error } = await supabase
    .from('favorites')
    .upsert(
      { user_id: user!.id, club_id: clubId },
      { onConflict: 'user_id,club_id' }
    )

  if (error) return err(error.message)
  return ok({ favorited: true }, 201)
}

// DELETE /api/favorites/:clubId — remove a saved club
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createClient()

  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', user!.id)
    .eq('club_id', clubId)

  if (error) return err(error.message)
  return ok({ unfavorited: true })
}
