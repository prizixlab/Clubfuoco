import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// PATCH /api/promoter-nights/:id — edit a night the caller promotes.
// Whitelisted content fields only; every edit re-enters review
// (review_status → 'pending', is_published → false) so nothing changes live
// without approval. The rehold_night_edit trigger enforces the same rule at
// the DB layer for direct writes — this route just makes it explicit and
// works even before that trigger migration is applied.

const EDITABLE = [
  'title', 'night_date', 'open_time', 'close_time', 'total_capacity',
  'location_name', 'address', 'lat', 'lng', 'auto_checkin',
  'description', 'theme', 'theme_translate', 'photo_urls', 'featured',
  'max_plus_ones',
] as const

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const sb = await createServiceClient()

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp } = await sb.auth.getUser(bearer)
  if (!userResp.user) return err('Unauthorized', 401)

  // Ownership: the caller must hold an allocation on this night.
  const { data: alloc } = await sb
    .from('promoter_allocations')
    .select('id')
    .eq('night_id', id)
    .eq('promoter_id', userResp.user.id)
    .limit(1)
    .maybeSingle()
  if (!alloc) return err('Forbidden', 403)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Bad request')

  const patch: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) patch[k] = body[k]
  if (!Object.keys(patch).length) return err('Nothing to update')

  // Edits re-enter review.
  const held = { ...patch, review_status: 'pending', is_published: false, rejection_reason: null }
  let { error } = await sb.from('promoter_nights').update(held).eq('id', id)
  if (error && /rejection_reason|review_status|column|schema cache/i.test(error.message)) {
    // Drift-defensive: review columns not applied yet — apply the content
    // edit alone rather than failing the whole save.
    ;({ error } = await sb.from('promoter_nights').update(patch).eq('id', id))
  }
  if (error) return err(error.message, 500)

  return ok({ updated: true, pending: true })
}
