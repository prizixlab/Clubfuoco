import { createServiceClient } from '@/lib/supabase/server'
import { requirePortal } from '@/lib/portal-auth'
import { ok, err } from '@/lib/utils'

// GET /api/portal/djs?q=solomun — typeahead over the DJ catalogue for the
// event line-up picker.
//
// The catalogue is ~3,200 rows keyed by `ra_artist_id` (there is NO `id`
// column), which is the same key an event's lineup entry stores, so a pick
// here resolves to a real artist rather than a free-typed name.
//
// Ordered by RA follower count: for a two-letter query the useful answer is
// almost always the better-known artist, and alphabetical would bury them.

export interface DJOption {
  id: string          // ra_artist_id
  name: string
  image_url: string | null
  followers: number | null
}

export async function GET(req: Request) {
  const denied = await requirePortal()
  if (denied) return denied

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return ok({ djs: [] as DJOption[] })

  const sb = await createServiceClient()

  // Escape PostgREST's pattern metacharacters and the comma that separates
  // filter arguments — an unescaped one would truncate the filter and silently
  // widen the match.
  const safe = q.replace(/[%,()*]/g, ' ').trim()
  if (!safe) return ok({ djs: [] as DJOption[] })

  const { data, error } = await sb
    .from('djs')
    .select('ra_artist_id, name, image_url, ra_followers')
    .ilike('name', `%${safe}%`)
    .order('ra_followers', { ascending: false, nullsFirst: false })
    .limit(20)

  if (error) return err(error.message, 500)

  const djs: DJOption[] = (data ?? []).map(d => ({
    id: d.ra_artist_id as string,
    name: d.name as string,
    image_url: (d.image_url as string) ?? null,
    followers: (d.ra_followers as number) ?? null,
  }))

  return ok({ djs })
}
