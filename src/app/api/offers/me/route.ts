import { NextRequest } from 'next/server'
import { brandOrNull, resolveOfferBrand } from '@/lib/offer-auth'
import { ok, err } from '@/lib/utils'

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

// PATCH /api/offers/me — edit the caller's own public brand identity (name +
// logo). This is what the promoter app's "You" tab saves for a brand-owning
// account: the brand is their public identity on the consumer app, not the
// `promoter_profiles` row (which is the private-events profile). Owner-scoped
// via resolveOfferBrand. `key` and `color` are NOT editable here — `key`
// is the stable slug/storage path, and `color` is part of the brand contract
// (set by an operator in the portal).
export async function PATCH(request: NextRequest) {
  const { brand, sb, response } = await resolveOfferBrand()
  if (response) return response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Bad request')

  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return err('Brand name cannot be empty')
    if (name.length > 60) return err('Brand name is too long')
    patch.name = name
  }
  if ('logo_url' in body) {
    const url = body.logo_url
    if (url !== null && typeof url !== 'string') return err('logo_url must be a string or null')
    patch.logo_url = url === '' ? null : url
  }
  if (!Object.keys(patch).length) return ok({ unchanged: true })

  const { error } = await sb.from('partner_brands').update(patch).eq('id', brand.id)
  if (error) return err(error.message, 500)

  return ok({ updated: true, ...patch })
}
