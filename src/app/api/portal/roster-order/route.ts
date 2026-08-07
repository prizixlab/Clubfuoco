import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { requirePortal } from '@/lib/portal-auth'
import { ROSTER_ORDER, getJsonSetting, setJsonSetting } from '@/lib/app-settings'

// The operator's preferred roster order, stored as an array of PromoterRow ids
// in app_settings — no schema change, and it survives promoters being added or
// removed (GET /api/portal/promoters ranks by this and appends the rest).
//
// Portal-wide rather than per-browser: the portal is a shared password, not
// per-user accounts, so a localStorage preference would silently differ between
// machines with no way to reconcile them.

export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  return ok({ order: await getJsonSetting<string[]>(sb, ROSTER_ORDER, []) })
}

export async function PUT(req: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied

  let body: { order?: unknown }
  try { body = await req.json() } catch { return err('Bad request', 400) }
  if (!Array.isArray(body.order)) return err('order must be an array of ids', 400)

  const order = body.order.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (order.length !== body.order.length) return err('order must contain only ids', 400)

  const sb = await createServiceClient()
  await setJsonSetting(sb, ROSTER_ORDER, order)
  return ok({ order })
}
