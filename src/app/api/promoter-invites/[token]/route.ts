import { createServiceClient } from '@/lib/supabase/server'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { ok, err } from '@/lib/utils'

/**
 * Public JSON description of a promoter invite — used by the native iOS
 * consumer app when it opens a /i/<token> Universal Link, mirroring the data
 * rendered by the web page at `/i/[token]`. Handles both one-off allocation
 * tokens and permanent series tokens (which resolve to the next live night).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const sb = await createServiceClient()

  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)

  const { data: alloc, error } = await sb
    .from('promoter_allocations')
    .select(`
      id, spots, group_visible, invite_token,
      night:promoter_nights (
        id, title, night_date, open_time, close_time,
        location_name, address, lat, lng, auto_checkin,
        club:clubs ( id, name, address, cover_image_url, lat, lng )
      ),
      promoter:users!promoter_allocations_promoter_id_fkey ( id, full_name )
    `)
    .eq('id', resolved.allocationId)
    .single()

  if (error || !alloc?.night) return err('Invite not found', 404)

  let guests: { id: string; full_name: string; plus_ones: number }[] = []
  if (alloc.group_visible) {
    const { data } = await sb
      .from('promoter_guests')
      .select('id, full_name, plus_ones')
      .eq('allocation_id', alloc.id)
      .order('created_at', { ascending: true })
    guests = data ?? []
  }

  // Surface the permanent token to the client so it keeps showing the same
  // link even though the underlying night rolls week to week.
  return ok({ allocation: { ...alloc, invite_token: resolved.seriesToken ?? alloc.invite_token }, guests })
}
