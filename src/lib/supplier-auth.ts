import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { getBrandByOwner, type PartnerBrand } from '@/lib/partner'
import { err } from '@/lib/utils'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Resolve the FuocoPromoters caller to the brand they own. The app sends
// `Authorization: Bearer <supabase jwt>`; we verify it, then look up the brand
// whose owner_user_id matches. Writes still go through the service client, so
// this ownership check IS the authorization boundary — every /api/supplier
// write must scope to the returned brand.
export async function resolveSupplierBrand(): Promise<
  | { brand: PartnerBrand & { id: string }; userId: string; sb: SB; response?: undefined }
  | { response: Response; brand?: undefined; userId?: undefined; sb?: undefined }
> {
  let token: string | null = null
  try {
    const h = await headers()
    token = h.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  } catch {
    // headers() unavailable
  }
  if (!token) return { response: err('Unauthorized', 401) }

  const sb = await createServiceClient()
  const { data: userResp } = await sb.auth.getUser(token)
  const user = userResp.user
  if (!user) return { response: err('Unauthorized', 401) }

  const brand = await getBrandByOwner(sb, user.id)
  if (!brand) return { response: err('No brand is linked to this account', 403) }

  return { brand, userId: user.id, sb }
}
