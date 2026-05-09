import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: dj } = await supabase.from('dj_profiles').select('id').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')

  const { data: photo } = await supabase.from('dj_photos').select('url').eq('id', id).eq('dj_id', dj.id).single()
  if (!photo) return err('Photo not found', 404)

  // Delete from storage
  const path = photo.url.split('/dj-media/')[1]
  if (path) await supabase.storage.from('dj-media').remove([path])

  const { error } = await supabase.from('dj_photos').delete().eq('id', id).eq('dj_id', dj.id)
  if (error) return err(error.message)
  return ok({ deleted: true })
}
