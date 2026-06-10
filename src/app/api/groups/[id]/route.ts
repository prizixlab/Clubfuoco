import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { getGroupDetail } from '@/lib/groups'

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
