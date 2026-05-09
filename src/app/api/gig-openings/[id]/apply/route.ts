import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET — club views applications for this opening
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()
  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')

  const { data, error } = await supabase
    .from('gig_applications')
    .select('*, dj_profiles(id, stage_name, avatar_url, genres, is_verified, follower_count)')
    .eq('opening_id', id)
    .order('created_at', { ascending: false })
  if (error) return err(error.message)
  return ok(data)
}

// POST — DJ applies to an opening
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: dj } = await supabase.from('dj_profiles').select('id, stage_name').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')

  const { message } = await request.json()

  const { data, error } = await supabase
    .from('gig_applications')
    .upsert({ opening_id: id, dj_id: dj.id, message, status: 'pending' }, { onConflict: 'opening_id,dj_id' })
    .select()
    .single()
  if (error) return err(error.message)

  // Notify club staff
  const { data: opening } = await supabase
    .from('gig_openings')
    .select('title, club_id')
    .eq('id', id)
    .single()
  if (opening) {
    const { data: staffList } = await supabase.from('club_staff').select('user_id').eq('club_id', opening.club_id)
    for (const s of staffList ?? []) {
      await notify({
        user_id: s.user_id,
        type: 'gig_application',
        title: `New application: ${opening.title}`,
        body: `${dj.stage_name} applied to your opening`,
        link: '/club-dashboard',
      })
    }
  }

  return ok(data, 201)
}
