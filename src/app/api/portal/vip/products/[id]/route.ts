import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'
import { setSellers } from '@/lib/vip-products'

const Body = z.object({ brand_ids: z.array(z.string().uuid()).max(30) }).strict()

// PUT /api/portal/vip/products/:id — the product's promoters, best first.
// The order IS the decision: on a night, the first who can sell gets the
// buy button; anyone suspended or shut down is skipped automatically.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid order')
  const sb = await createServiceClient()
  const res = await setSellers(sb, id, parsed.data.brand_ids)
  if (res) return err(res, /schema change/.test(res) ? 503 : 500)
  const { data: product } = await sb.from('vip_products').select('name, club_id').eq('id', id).maybeSingle()
  await logAudit(sb, {
    action: 'vip.product_sellers',
    summary: `Ranked ${parsed.data.brand_ids.length} seller${parsed.data.brand_ids.length === 1 ? '' : 's'} for “${product?.name ?? id}”`,
    target_type: 'club', target_id: product?.club_id ?? undefined,
    meta: { product_id: id, brand_ids: parsed.data.brand_ids },
  })
  return ok({ id, brand_ids: parsed.data.brand_ids })
}
