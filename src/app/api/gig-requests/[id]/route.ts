import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// PATCH — DJ accepts or rejects a club's direct request
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: dj } = await supabase.from('dj_profiles').select('id, stage_name').eq('user_id', user!.id).single()
  if (!dj) return err('No DJ profile')

  const { status } = await request.json()
  if (!['accepted', 'rejected'].includes(status)) return err('Invalid status')

  const { data, error } = await supabase
    .from('gig_requests')
    .update({ status })
    .eq('id', id)
    .eq('dj_id', dj.id)
    .select('*, clubs(id, name)')
    .single()
  if (error) return err(error.message)

  // Notify club staff
  const clubId = (data as any).clubs?.id
  if (clubId) {
    const { data: staffList } = await supabase.from('club_staff').select('user_id').eq('club_id', clubId)
    for (const s of staffList ?? []) {
      await notify({
        user_id: s.user_id,
        type: status === 'accepted' ? 'gig_confirmed' : 'gig_rejected',
        title: status === 'accepted' ? `${dj.stage_name} accepted!` : `Request declined`,
        body: status === 'accepted'
          ? `${dj.stage_name} confirmed your booking request`
          : `${dj.stage_name} declined your booking request`,
        link: '/club-dashboard',
      })
    }
  }

  return ok(data)
}
