import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { getGroupDetail } from '@/lib/groups'
import { normalizeInviteCode } from '@/lib/url'

// GET /api/groups/code/[code] — resolve an invite code to its group detail
// (lets the join-by-link screen preview before joining).
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response

  const { code: raw } = await params
  const code = normalizeInviteCode(raw)
  if (!code) return err('Invite not found', 404)

  const sb = await createServiceClient()

  const { data: group } = await sb
    .from('booking_groups')
    .select('id')
    .eq('invite_code', code)
    .maybeSingle()
  if (!group) return err('Invite not found', 404)

  const detail = await getGroupDetail(sb, group.id, user!.id)
  if (!detail) return err('Group not found', 404)
  return ok(detail)
}
