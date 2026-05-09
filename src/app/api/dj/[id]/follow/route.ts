import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createClient()

  const { error } = await supabase.from('dj_follows').upsert({ user_id: user!.id, dj_id: id }, { onConflict: 'user_id,dj_id' })
  if (error) return err(error.message)

  // Notify the DJ
  const { data: dj } = await supabase.from('dj_profiles').select('user_id, stage_name').eq('id', id).single()
  if (dj?.user_id) {
    await notify({
      user_id: dj.user_id,
      type: 'new_follower',
      title: 'New follower',
      body: `Someone started following ${dj.stage_name}`,
      link: '/dj-dashboard',
    })
  }

  return ok({ following: true })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createClient()
  const { error } = await supabase.from('dj_follows').delete().eq('user_id', user!.id).eq('dj_id', id)
  if (error) return err(error.message)
  return ok({ following: false })
}
