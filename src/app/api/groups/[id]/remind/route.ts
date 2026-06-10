import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'

// POST /api/groups/[id]/remind — organizer nudges everyone who hasn't locked in
// yet (still 'invited' or 'maybe').
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id: groupId } = await params

  const sb = await createServiceClient()

  const { data: group } = await sb
    .from('booking_groups')
    .select('id, organizer_id, clubs(name)')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return err('Group not found', 404)
  if (group.organizer_id !== me) return err('Only the organizer can send reminders', 403)

  const { data: pending } = await sb
    .from('booking_group_members')
    .select('user_id, rsvp')
    .eq('group_id', groupId)
    .in('rsvp', ['invited', 'maybe'])
  const targets = (pending ?? []).filter(m => m.user_id !== me)
  if (!targets.length) return ok({ reminded: 0 })

  const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
  const { data: meRow } = await sb.from('users').select('full_name').eq('id', me).maybeSingle()
  const myName = meRow?.full_name?.trim() || 'Your friend'

  await Promise.all(targets.map(m =>
    notify({
      user_id: m.user_id,
      type: 'group_reminder',
      title: `${myName} is waiting on your RSVP for ${club?.name ?? 'the night'}`,
      body: 'Tap to let them know if you’re in.',
      link: `/groups/placeholder?id=${groupId}`,
    }),
  ))

  return ok({ reminded: targets.length })
}
