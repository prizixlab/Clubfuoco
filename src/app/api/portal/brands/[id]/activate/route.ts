import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand, setBrandFeatured } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// POST /api/portal/brands/:id/activate — feature or unfeature one brand.
//
// Body: { featured?: boolean } (default true). No longer exclusive: featuring
// a brand leaves the others alone, so several can be featured at once. Until
// 20260722_multi_featured_brands.sql is applied the database still enforces
// one, and setBrandFeatured falls back to unset-then-set.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()

  const body = await req.json().catch(() => null)
  const featured = (body as { featured?: unknown } | null)?.featured !== false

  const brand = await getBrand(sb, id)
  if (!brand) return err('Brand not found', 404)

  try {
    await setBrandFeatured(sb, id, featured)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not change featured brand', 500)
  }
  await logAudit(sb, {
    action: featured ? 'brand.feature' : 'brand.unfeature',
    summary: `${featured ? 'Featured' : 'Un-featured'} “${brand.name}”`,
    target_type: 'brand', target_id: id, meta: { offer_count: brand.offer_count },
  })
  return ok({ brand: brand.key, featured })
}
