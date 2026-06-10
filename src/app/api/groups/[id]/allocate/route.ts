import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  allocations: z.array(z.object({
    member_id:  z.string().uuid(),
    amount_due: z.number().nonnegative(),
  })).min(1),
})

// POST /api/groups/[id]/allocate — organizer sets who pays how much.
// Only affects members who haven't paid yet.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id: groupId } = await params

  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) return err('Invalid allocations')

  const sb = await createServiceClient()

  const { data: group } = await sb
    .from('booking_groups')
    .select('id, organizer_id')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return err('Group not found', 404)
  if (group.organizer_id !== me) return err('Only the organizer can do this', 403)

  for (const a of parsed.data.allocations) {
    await sb.from('booking_group_members')
      .update({ amount_due: a.amount_due, payment_required: a.amount_due > 0 })
      .eq('id', a.member_id)
      .eq('group_id', groupId)
      .eq('paid', false)
  }

  return ok({ updated: true })
}
