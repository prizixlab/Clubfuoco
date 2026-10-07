import { NextRequest } from 'next/server'
import { z } from 'zod'
import { brandOrNull, resolveOfferBrand } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'
import { getBrandVip, saveBrandVip } from '@/lib/vip-products'
import { createServiceClient } from '@/lib/supabase/server'

// The promoter app's VIP controls (Bearer, owner-scoped like /api/offers/**).
//
// Promoters don't price tables — the club's saved Fourvenues tables are the
// products, and Club Fuoco ranks who sells which in the portal. What a
// promoter controls is whether THEY are selling: suspend a night, pause a
// venue, shut VIP down, and what the guest may pay (deposit / full / both).
// Whoever is ranked next takes the table the moment they step back.
//
// Venues themselves (which clubs, which weekdays) are set by Club Fuoco.

export async function GET() {
  const { brand, response } = await brandOrNull()
  if (response) return response
  if (!brand) return ok({ vip: null })
  return ok({ vip: await getBrandVip(await createServiceClient(), brand.id) })
}

const Patch = z.object({
  vip_paused:  z.boolean().optional(),
  vip_payment: z.enum(['both', 'deposit', 'full']).optional(),
  venues: z.array(z.object({
    club_id:       z.string().uuid(),
    skipped_dates: z.array(z.string()).max(400).optional(),
    paused:        z.boolean().optional(),
  })).max(200).optional(),
}).strict()

export async function PATCH(request: NextRequest) {
  const { brand, sb, response } = await resolveOfferBrand()
  if (response) return response
  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid VIP settings')
  const { venues, ...rest } = parsed.data
  // venue_updates only edits venues the promoter already has — it can't add.
  const fail = await saveBrandVip(sb, brand.id, { ...rest, venue_updates: venues })
  if (fail) return err(fail, /schema change/.test(fail) ? 503 : 500)
  return ok({ vip: await getBrandVip(sb, brand.id) })
}
