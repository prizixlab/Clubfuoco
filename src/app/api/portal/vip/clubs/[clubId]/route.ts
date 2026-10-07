import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'
import { setSellers } from '@/lib/vip-products'

const Body = z.object({ brand_ids: z.array(z.string().uuid()).max(30) }).strict()

// PUT /api/portal/vip/clubs/:clubId — the same seller order on EVERY table
// at the club (one tap instead of nine at Opium). Individual tables can be
// re-ordered afterwards.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ clubId: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { clubId } = await params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid order')
  const sb = await createServiceClient()
  const { data: products, error } = await sb.from('vip_products').select('id').eq('club_id', clubId)
  if (error) return err(error.message, 500)
  for (const p of products ?? []) {
    const res = await setSellers(sb, String(p.id), parsed.data.brand_ids)
    if (res) return err(res, 500)
  }
  const { data: club } = await sb.from('clubs').select('name').eq('id', clubId).maybeSingle()
  await logAudit(sb, {
    action: 'vip.club_sellers',
    summary: `Set the seller order on all ${products?.length ?? 0} tables at ${club?.name ?? clubId}`,
    target_type: 'club', target_id: clubId, meta: { brand_ids: parsed.data.brand_ids },
  })
  return ok({ club_id: clubId, tables: products?.length ?? 0 })
}
