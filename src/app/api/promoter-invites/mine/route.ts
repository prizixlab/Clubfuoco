import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

/**
 * Returns every promoter-invite this user has claimed (joined to allocation
 * → night → club). Consumed by the consumer Fuoco app's Bookings/Tickets tab.
 * Service role under the hood; caller identified by Bearer token.
 */
export async function GET(req: Request) {
  const sb = await createServiceClient()
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp, error: userErr } = await sb.auth.getUser(bearer)
  if (userErr || !userResp.user) return err('Unauthorized', 401)

  const { data, error } = await sb
    .from('promoter_guests')
    .select(`
      id, full_name, plus_ones, checked_in_at, created_at,
      allocation:promoter_allocations (
        id, invite_token, spots,
        night:promoter_nights (
          id, title, night_date, open_time, close_time,
          club:clubs ( id, name, address )
        )
      )
    `)
    .eq('claimed_by_user', userResp.user.id)
    .order('created_at', { ascending: false })

  if (error) return err('Failed to load invites', 500)
  return ok({ invites: data ?? [] })
}
