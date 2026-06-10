import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  friendship_id: z.string().uuid(),
  action:        z.enum(['accept', 'decline']),
})

// POST /api/friends/respond — the addressee accepts or declines a pending request
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id

  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) return err('friendship_id and action required')
  const { friendship_id, action } = parsed.data

  const sb = await createServiceClient()

  const { data: row } = await sb
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .eq('id', friendship_id)
    .maybeSingle()

  if (!row) return err('Request not found', 404)
  // Only the addressee of a pending request may respond to it.
  if (row.addressee_id !== me || row.status !== 'pending') return err('Not allowed', 403)

  if (action === 'decline') {
    const { error } = await sb.from('friendships').delete().eq('id', friendship_id)
    if (error) return err(error.message)
    return ok({ status: 'declined' })
  }

  const { error } = await sb
    .from('friendships')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', friendship_id)
  if (error) return err(error.message)

  const { data: meRow } = await sb.from('users').select('full_name').eq('id', me).maybeSingle()
  const myName = meRow?.full_name?.trim() || 'Someone'
  await notify({ user_id: row.requester_id, type: 'friend_accept', title: `${myName} accepted your friend request`, link: '/friends' })

  return ok({ status: 'accepted' })
}
