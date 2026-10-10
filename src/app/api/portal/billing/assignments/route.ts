import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/billing/assignments  { club_id, night, brand_id | null }
// Assigns (or, with brand_id null, un-assigns) the promoter for an event — a
// club on a night — whose app entries have no promoter of their own.

const MISSING = 'Event assignment table not set up yet — apply 20261010_billing_assignments.sql'

export async function POST(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  let body: { club_id?: string; night?: string; brand_id?: string | null; label?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const { club_id, night } = body
  if (!club_id || !night || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return err('club_id and night (YYYY-MM-DD) required', 400)

  const sb = await createServiceClient()
  const label = (body.label ?? '').slice(0, 120) || `${night}`

  if (!body.brand_id) {
    const { error } = await sb.from('billing_assignments').delete().eq('club_id', club_id).eq('night', night)
    if (error) return err(/billing_assignments/.test(error.message) ? MISSING : error.message, error.code === '42P01' ? 503 : 500)
    await logAudit(sb, {
      action: 'billing.unassign',
      summary: `Billing: removed the promoter from ${label}`,
      target_type: 'billing_assignment',
      meta: { club_id, night },
    })
    return ok({ club_id, night, brand_id: null })
  }

  const { data: brand } = await sb.from('partner_brands').select('id, name').eq('id', body.brand_id).maybeSingle()
  if (!brand) return err('Unknown promoter', 400)

  const { error } = await sb.from('billing_assignments')
    .upsert({ club_id, night, brand_id: brand.id }, { onConflict: 'club_id,night' })
  if (error) return err(/billing_assignments/.test(error.message) ? MISSING : error.message, error.code === '42P01' ? 503 : 500)

  await logAudit(sb, {
    action: 'billing.assign',
    summary: `Billing: ${label} assigned to ${brand.name}`,
    target_type: 'billing_assignment',
    target_id: brand.id,
    meta: { club_id, night, brand_id: brand.id },
  })
  return ok({ club_id, night, brand_id: brand.id })
}
