import { brandOrNull } from '@/lib/supplier-auth'
import { ok } from '@/lib/utils'

// GET /api/offers/me — the brand this promoter publishes public offers
// under, or null if they haven't published one yet (the brand is provisioned
// lazily on their first public offer). NOT a mode switch: promoters and
// suppliers are one role, so the app no longer branches on this.
export async function GET() {
  const { brand, response } = await brandOrNull()
  if (response) return response
  return ok({
    brand: brand
      ? {
          id: brand.id, key: brand.key, name: brand.name,
          logo_url: brand.logo_url, color: brand.color,
        }
      : null,
  })
}
