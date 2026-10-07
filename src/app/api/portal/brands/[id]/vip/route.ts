import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'
import { getBrandVip, saveBrandVip } from '@/lib/vip-products'

// A promoter's VIP set-up, operator side: where and when they do VIP, VIP shut
// down, and what the guest may pay (deposit / full / both). The promoter app
// edits the same record, minus adding or removing venues.

const Patch = z.object({
  vip_paused:  z.boolean().optional(),
  vip_payment: z.enum(['both', 'deposit', 'full']).optional(),
  venues: z.array(z.object({
    club_id:       z.string().uuid(),
    valid_days:    z.string().trim().max(120),
    skipped_dates: z.array(z.string()).max(400).optional(),
    paused:        z.boolean().optional(),
  })).max(200).optional(),
}).strict()

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const vip = await getBrandVip(await createServiceClient(), id)
  return vip ? ok(vip) : err('Promoter not found', 404)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid VIP settings')
  const sb = await createServiceClient()
  const fail = await saveBrandVip(sb, id, parsed.data)
  if (fail) return err(fail, /schema change/.test(fail) ? 503 : 500)
  const { data: brand } = await sb.from('partner_brands').select('name').eq('id', id).maybeSingle()
  await logAudit(sb, {
    action: 'brand.vip',
    summary: `Updated VIP for ${brand?.name ?? id}` +
      (parsed.data.vip_paused !== undefined ? (parsed.data.vip_paused ? ' — VIP shut down' : ' — VIP on') : ''),
    target_type: 'brand', target_id: id, meta: parsed.data,
  })
  return ok(await getBrandVip(sb, id))
}
