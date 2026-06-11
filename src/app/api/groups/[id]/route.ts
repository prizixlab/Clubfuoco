import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { getGroupDetail } from '@/lib/groups'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// GET /api/groups/[id] — full group detail for the viewer
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { id } = await params
  const sb = await createServiceClient()
  const detail = await getGroupDetail(sb, id, user!.id)
  if (!detail) return err('Group not found', 404)
  return ok(detail)
}

const patchSchema = z.object({ status: z.enum(['open', 'closed', 'cancelled']) })

// PATCH /api/groups/[id] — organizer opens/closes/cancels the night.
// Cancelling notifies everyone who hadn't declined. (Refunds for already-paid
// members are the organizer's to sort for now — the notification says so.)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id } = await params

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('status must be open, closed or cancelled')

  const sb = await createServiceClient()
  const { data: group } = await sb
    .from('booking_groups')
    .select('id, organizer_id, status, clubs(name)')
    .eq('id', id)
    .maybeSingle()
  if (!group) return err('Group not found', 404)
  if (group.organizer_id !== me) return err('Only the organizer can do this', 403)

  const { error } = await sb.from('booking_groups').update({ status: parsed.data.status }).eq('id', id)
  if (error) return err(error.message)

  if (parsed.data.status === 'cancelled') {
    const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
    const { data: members } = await sb
      .from('booking_group_members')
      .select('user_id, rsvp, paid')
      .eq('group_id', id)
      .neq('rsvp', 'declined')
    await Promise.all((members ?? []).filter(m => m.user_id !== me).map(m =>
      notify({
        user_id: m.user_id,
        type: 'group_cancelled',
        title: `The night at ${club?.name ?? 'the club'} was called off`,
        body: m.paid ? 'You paid for this night — the organizer will sort your refund.' : 'The organizer cancelled the plan.',
        link: `/groups/placeholder?id=${id}`,
      }),
    ))
  }

  return ok({ status: parsed.data.status })
}
