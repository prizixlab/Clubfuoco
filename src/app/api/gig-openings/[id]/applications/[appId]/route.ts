import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// PATCH — club accepts or rejects an application
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; appId: string }> }) {
  const { id, appId } = await params
  const { user, response } = await requireAuth()
  if (response) return response
  const supabase = await createServiceClient()

  const { data: staff } = await supabase.from('club_staff').select('club_id').eq('user_id', user!.id).single()
  if (!staff) return err('Not linked to a club')

  const { status, fee_cents, payment_method } = await request.json()
  if (!['accepted', 'rejected'].includes(status)) return err('Invalid status')

  const updates: Record<string, any> = { status }
  if (fee_cents !== undefined) updates.fee_cents = fee_cents
  if (payment_method) updates.payment_method = payment_method
  if (status === 'accepted') updates.payment_status = payment_method === 'off_app' ? 'off_app' : 'unpaid'

  const { data, error } = await supabase
    .from('gig_applications')
    .update(updates)
    .eq('id', appId)
    .eq('opening_id', id)
    .select('*, dj_profiles(user_id, stage_name), gig_openings(title, clubs(name))')
    .single()
  if (error) return err(error.message)

  const djUserId = (data as any).dj_profiles?.user_id
  const openingTitle = (data as any).gig_openings?.title
  const clubName = (data as any).gig_openings?.clubs?.name
  if (djUserId) {
    await notify({
      user_id: djUserId,
      type: status === 'accepted' ? 'gig_confirmed' : 'gig_rejected',
      title: status === 'accepted' ? `You got the gig!` : `Application update`,
      body: status === 'accepted'
        ? `${clubName} accepted you for "${openingTitle}"`
        : `${clubName} passed on your application for "${openingTitle}"`,
      link: '/dj-dashboard',
    })
  }

  return ok(data)
}
