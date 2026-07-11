import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { getBrand, updateBrand } from '@/lib/partner'
import { ok, err } from '@/lib/utils'

// GET /api/portal/brands/:id — one brand (editor bootstrap).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const sb = await createServiceClient()
  const brand = await getBrand(sb, id)
  return brand ? ok(brand) : err('Brand not found', 404)
}

const PatchBrand = z.object({
  name:                 z.string().trim().min(1).max(60).optional(),
  color:                z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #RRGGBB hex').optional(),
  logo_url:             z.string().url().nullable().optional(),
  attribution_required: z.boolean().optional(),
  attribution_label:    z.string().trim().min(1).max(40).nullable().optional(),
  // Supplier's login email for the FuocoPromoters app. Empty → null.
  login_email:          z.string().trim().email('Enter a valid email').max(160).nullable().optional(),
}).strict()   // rejects `key` — the slug is immutable after create

// PATCH /api/portal/brands/:id — edit identity + attribution. Never `key`.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePortal()
  if (denied) return denied
  const { id } = await params
  const parsed = PatchBrand.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid patch')
  if (Object.keys(parsed.data).length === 0) return err('Nothing to update')

  const sb = await createServiceClient()
  try {
    await updateBrand(sb, id, parsed.data)
    return ok(await getBrand(sb, id))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not update brand', 500)
  }
}
