import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand, activateBrand } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/brands/:id/activate — the switch. Transactional via the
// set_active_brand RPC (falls back to unset-then-set pre-migration), so the
// one-active partial-unique index never conflicts. Activating a brand with no
// offers blanks the front-page shelf — the UI warns, the server doesn't block.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()

  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)

  try {
    await activateBrand(sb, id)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not activate brand', 500)
  }
  await logAudit(sb, { action: 'brand.activate', summary: `Made “${brand.name}” the live partner`, target_type: 'brand', target_id: id, meta: { offer_count: brand.offer_count } })
  return ok({ activated: brand.key, offer_count: brand.offer_count })
}
