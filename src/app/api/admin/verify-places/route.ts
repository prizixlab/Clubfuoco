import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireCronOrRole } from '@/lib/auth'

const KEY  = process.env.GOOGLE_PLACES_API_KEY!
const BASE = 'https://maps.googleapis.com/maps/api/place'

/**
 * GET /api/admin/verify-places?batch=40&offset=0&since=2026-05-08
 *
 * Checks all clubs whose google_place_id was set on or after `since`.
 * For each, confirms the Google name matches our club name.
 * If it doesn't match, clears the place_id + photos so backfill-places
 * can re-process it with the corrected (no type=bar) search logic.
 */
export async function GET(req: NextRequest) {
  // Vercel cron (CRON_SECRET bearer) or a logged-in admin/staff member.
  const { response } = await requireCronOrRole(req, ['admin', 'staff'])
  if (response) return response

  const batch  = Math.min(parseInt(req.nextUrl.searchParams.get('batch') ?? '40'), 100)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0')
  const since  = req.nextUrl.searchParams.get('since') ?? '2026-05-08'

  const supabase = await createServiceClient()

  const { data: clubs, error, count } = await supabase
    .from('clubs')
    .select('id, name, google_place_id', { count: 'exact' })
    .eq('is_active', true)
    .not('google_place_id', 'is', null)
    .gte('last_synced_at', `${since}T00:00:00Z`)
    .order('name')
    .range(offset, offset + batch - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results = { verified: 0, mismatch_cleared: 0, errors: 0, total: count ?? 0 }

  for (const club of clubs ?? []) {
    try {
      const detailRes  = await fetch(
        `${BASE}/details/json?place_id=${club.google_place_id}&fields=name&key=${KEY}`
      )
      const detailData = await detailRes.json()
      const googleName = (detailData.result?.name ?? '').toLowerCase()

      // Name match: at least one significant word (>3 chars) from our name
      // must appear in Google's name
      const ourWords  = club.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
      const nameMatch = ourWords.length === 0 || ourWords.some((w: string) => googleName.includes(w))

      if (nameMatch) {
        results.verified++
      } else {
        // Clear the wrong data so backfill-places will re-process this club
        await supabase.from('clubs').update({
          google_place_id: null,
          cover_image_url: null,
          gallery_urls:    [],
          photos:          [],
          last_synced_at:  null,
        }).eq('id', club.id)
        results.mismatch_cleared++
      }
    } catch {
      results.errors++
    }

    await new Promise(r => setTimeout(r, 120)) // ~8 QPS
  }

  const nextOffset = offset + batch
  const done       = nextOffset >= (count ?? 0)

  return NextResponse.json({
    ok: true, batch, offset,
    next_offset: done ? null : nextOffset,
    done,
    ...results,
  })
}
