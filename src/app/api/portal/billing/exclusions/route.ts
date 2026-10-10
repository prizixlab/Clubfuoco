import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST   /api/portal/billing/exclusions  { user_id, reason? }            → this person never counts
//                                        { source, line_id, reason? }    → this one entry doesn't count
// DELETE /api/portal/billing/exclusions?id=<exclusion id>                → counts again

const SOURCES = ['offer', 'event', 'fourvenues']
const MISSING = 'Billing exclusions table not set up yet — apply 20261010_billing_exclusions.sql'

export async function POST(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  let body: { user_id?: string; source?: string; line_id?: string; reason?: string; label?: string }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  const reason = (body.reason ?? '').trim().slice(0, 200) || null

  let row: Record<string, unknown>
  if (body.user_id) row = { user_id: body.user_id, reason }
  else if (body.line_id && body.source && SOURCES.includes(body.source)) row = { source: body.source, line_id: body.line_id, reason }
  else return err('Pass user_id, or source + line_id', 400)

  const sb = await createServiceClient()
  const { data, error } = await sb.from('billing_exclusions').insert(row).select('id').single()
  if (error) {
    if (error.code === '23505') return err('Already excluded', 409)
    if (error.code === '42P01' || /billing_exclusions/.test(error.message)) return err(MISSING, 503)
    return err(error.message, 500)
  }

  const label = (body.label ?? '').slice(0, 120)
  await logAudit(sb, {
    action: 'billing.exclude',
    summary: body.user_id
      ? `Billing: stopped counting ${label || 'a guest'} (all entries)${reason ? ` — ${reason}` : ''}`
      : `Billing: stopped counting one entry${label ? ` (${label})` : ''}${reason ? ` — ${reason}` : ''}`,
    target_type: 'billing_exclusion',
    target_id: data.id,
    meta: row,
  })
  return ok({ id: data.id })
}

export async function DELETE(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return err('id required', 400)

  const sb = await createServiceClient()
  const { data, error } = await sb.from('billing_exclusions').delete().eq('id', id).select('*').maybeSingle()
  if (error) return err(error.message, 500)
  if (!data) return err('Not found', 404)

  await logAudit(sb, {
    action: 'billing.include',
    summary: data.user_id ? 'Billing: counting a guest again (all entries)' : 'Billing: counting one entry again',
    target_type: 'billing_exclusion',
    target_id: id,
    meta: data,
  })
  return ok({ id })
}
