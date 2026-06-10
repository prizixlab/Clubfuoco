import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(19),
})

// POST /api/groups/[id]/invite — organizer adds friends to an existing group.
// New members default to guests (amount_due 0); the organizer sets who pays via
// the allocate route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id: groupId } = await params

  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) return err('user_ids required')

  const sb = await createServiceClient()

  const { data: group } = await sb
    .from('booking_groups')
    .select('id, organizer_id, status, clubs(name)')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return err('Group not found', 404)
  if (group.organizer_id !== me) return err('Only the organizer can invite', 403)
  if (group.status !== 'open') return err('This group is closed', 400)

  // Skip anyone already in the group
  const { data: current } = await sb
    .from('booking_group_members')
    .select('user_id')
    .eq('group_id', groupId)
  const have = new Set((current ?? []).map(r => r.user_id))
  const toAdd = parsed.data.user_ids.filter(uid => uid !== me && !have.has(uid))
  if (!toAdd.length) return ok({ invited: 0 })

  const { error: insErr } = await sb.from('booking_group_members').insert(
    toAdd.map(uid => ({
      group_id: groupId, user_id: uid, role: 'member', rsvp: 'invited',
      payment_required: false, amount_due: null,
    })),
  )
  if (insErr) return err(insErr.message)

  const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
  const { data: meRow } = await sb.from('users').select('full_name').eq('id', me).maybeSingle()
  const myName = meRow?.full_name?.trim() || 'A friend'
  await Promise.all(toAdd.map(uid =>
    notify({
      user_id: uid,
      type: 'group_invite',
      title: `${myName} invited you out at ${club?.name ?? 'a club'}`,
      body: 'Tap to see the plan and confirm.',
      link: `/groups/${groupId}`,
    }),
  ))

  return ok({ invited: toAdd.length })
}
