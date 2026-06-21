import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

/**
 * Public JSON description of a promoter invite — used by the native iOS
 * consumer app when it opens a /i/<token> Universal Link, mirroring the data
 * rendered by the web page at `/i/[token]`. Envelope-wrapped to match
 * the rest of the API contract that APIClient consumes.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const sb = await createServiceClient()
  const { data: alloc, error } = await sb
    .from('promoter_allocations')
    .select(`
      id, spots, group_visible, invite_token,
      night:promoter_nights (
        id, title, night_date, open_time, close_time,
        club:clubs ( id, name, address, cover_image_url, lat, lng )
      ),
      promoter:users!promoter_allocations_promoter_id_fkey ( id, full_name )
    `)
    .eq('invite_token', token)
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

  return ok({ allocation: alloc, guests })
}
