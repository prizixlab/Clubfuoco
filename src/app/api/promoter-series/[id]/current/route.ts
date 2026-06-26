import { createServiceClient } from '@/lib/supabase/server'
import { resolveOccurrenceDate, ensureOccurrence, type PromoterSeries } from '@/lib/promoter-series'
import { ok, err } from '@/lib/utils'

/**
 * Resolve + materialize the current occurrence of a promoter series and return
 * its allocation id. Used by the promoter app to open "this week's" guestlist
 * for a recurring (permanent-link) series. Caller must own the series.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const sb = await createServiceClient()

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp } = await sb.auth.getUser(bearer)
  if (!userResp.user) return err('Unauthorized', 401)

  const { data: series } = await sb
    .from('promoter_series')
    .select('*')
    .eq('id', id)
    .single()
  if (!series) return err('Series not found', 404)
  if (series.promoter_id !== userResp.user.id) return err('Forbidden', 403)

  const date = resolveOccurrenceDate(series as PromoterSeries)
  if (!date) return err('No upcoming occurrence', 404)

  const allocationId = await ensureOccurrence(sb, series as PromoterSeries, date)
  if (!allocationId) return err('Failed to materialize occurrence', 500)

  return ok({ allocationId, nightDate: date })
}
