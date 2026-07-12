import { resolveSupplierBrand } from '@/lib/supplier-auth'
import { ok } from '@/lib/utils'

// GET /api/supplier/me — the brand this FuocoPromoters account manages. The app
// calls it after sign-in to decide whether to show the supplier experience.
export async function GET() {
  const { brand, response } = await resolveSupplierBrand()
  if (response) return response
  return ok({
    brand: {
      id: brand.id, key: brand.key, name: brand.name,
      logo_url: brand.logo_url, color: brand.color,
    },
  })
}
