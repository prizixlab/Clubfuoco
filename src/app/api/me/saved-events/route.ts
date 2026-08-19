import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'

// GET /api/me/saved-events
//
// The "pinned" list on the tickets screen: events the guest said yes to but
// hasn't paid for. These are bookmarks, not tickets — no QR, no Wallet pass, no
// spot held — so the screen has to present them as unfinished business rather
// than as entry.
//
// Past nights are dropped rather than shown greyed out. A saved event whose
// date has gone is not a decision the guest can still make.
export async function GET(req: Request) {
  const sb = await createServiceClient()

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!bearer) return err('Unauthorized', 401)
  const { data: userResp } = await sb.auth.getUser(bearer)
  const userId = userResp.user?.id
  if (!userId) return err('Unauthorized', 401)

  const { data, error } = await sb
    .from('promoter_saved_events')
    .select(`
      allocation_id, invite_token, created_at,
      allocation:promoter_allocations (
        id, spots,
        night:promoter_nights (
          id, title, night_date, open_time, price_cents, currency,
          location_name, club:clubs ( id, name, cover_image_url )
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)

  // Today counts as upcoming — a night on the 17th is still live at 2am on the
  // 18th, and dropping it at midnight would take the ticket away mid-night.
  const today = new Date().toISOString().slice(0, 10)

  const events = (data ?? []).flatMap(row => {
    const alloc = Array.isArray(row.allocation) ? row.allocation[0] : row.allocation
    const night = alloc?.night
    const n = (Array.isArray(night) ? night[0] : night) as unknown as {
      id: string; title: string | null; night_date: string; open_time: string | null
      price_cents: number | null; currency: string | null; location_name: string | null
      club: { id: string; name: string; cover_image_url: string | null } | null
    } | undefined
    if (!n || n.night_date < today) return []
    const club = Array.isArray(n.club) ? n.club[0] : n.club
    return [{
      allocation_id: row.allocation_id,
      invite_token: row.invite_token,
      night_id: n.id,
      title: n.title,
      night_date: n.night_date,
      open_time: n.open_time,
      venue_name: club?.name ?? n.location_name ?? 'Location TBA',
      cover_image_url: club?.cover_image_url ?? null,
      price_cents: n.price_cents ?? 0,
      currency: n.currency ?? 'eur',
    }]
  })

  return ok({ events })
}
