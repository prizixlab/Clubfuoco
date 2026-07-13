import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { listBrands, createBrand } from '@/lib/partner'
import { logAudit } from '@/lib/portal-audit'
import { ok, err } from '@/lib/utils'

// GET /api/portal/brands — every brand + its offer count, for the portal list.
export async function GET() {
  const denied = await requirePortal()
  if (denied) return denied
  const sb = await createServiceClient()
  try {
    return ok(await listBrands(sb))
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not list brands', 500)
  }
}

const CreateBrand = z.object({
  // Stable slug — immutable after create (storage path + client cache key).
  key:   z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, 'key must be a lowercase slug (a-z, 0-9, -)'),
  name:  z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #RRGGBB hex'),
})

// POST /api/portal/brands — create a (inactive) brand.
export async function POST(request: NextRequest) {
  const denied = await requirePortal()
  if (denied) return denied
  const parsed = CreateBrand.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid brand')

  const sb = await createServiceClient()
  try {
    const brand = await createBrand(sb, parsed.data)
    await logAudit(sb, { action: 'brand.create', summary: `Created brand “${brand.name}” (${brand.key})`, target_type: 'brand', target_id: brand.id })
    return ok(brand, 201)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not create brand'
    return err(/duplicate key/.test(msg) ? `A brand with key "${parsed.data.key}" already exists` : msg)
  }
}
