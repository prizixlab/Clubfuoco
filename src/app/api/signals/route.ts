import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'

// ── POST — log a click signal (Maps / Uber tap toward a venue) ──────────────
export async function POST(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  const kind = body.kind
  if (!['maps_click', 'uber_click'].includes(kind)) return err('Invalid signal kind')
  if (!body.club_id) return err('club_id is required')

  const supabase = await createServiceClient()
  const { error } = await supabase.from('venue_signals').insert({
    user_id: user!.id,
    club_id: String(body.club_id),
    kind,
  })
  if (error) return err(error.message)
  return ok({ logged: true })
}

// ── GET — venues to ask the user about ("Were you at X?") ───────────────────
// Any unanswered signal from the last 36h, de-duplicated to one per venue.
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const supabase = await createServiceClient()
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString()

  const { data: signals, error } = await supabase
    .from('venue_signals')
    .select('id, club_id, kind, created_at')
    .eq('user_id', user!.id)
    .eq('asked', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) return err(error.message)

  // One prompt per venue — keep the most recent signal, prefer a stronger kind.
  const rank: Record<string, number> = { geo_presence: 3, uber_click: 2, maps_click: 1 }
  const byClub = new Map<string, any>()
  for (const s of signals ?? []) {
    const cur = byClub.get(s.club_id)
    if (!cur || (rank[s.kind] ?? 0) > (rank[cur.kind] ?? 0)) byClub.set(s.club_id, s)
  }
  const clubIds = [...byClub.keys()].slice(0, 5)
  if (!clubIds.length) return ok([])

  const { data: clubs } = await supabase
    .from('clubs').select('id, name').in('id', clubIds)
  const nameOf = new Map((clubs ?? []).map((c: any) => [c.id, c.name]))

  return ok(clubIds.map(id => ({
    club_id: id,
    name:    nameOf.get(id) ?? 'a venue',
    kind:    byClub.get(id).kind,
  })))
}

// ── PATCH — record the user's answer to a "Were you at X?" prompt ───────────
export async function PATCH(req: Request) {
  const { user, response } = await requireAuth()
  if (response) return response

  const body = await req.json().catch(() => ({}))
  if (!body.club_id) return err('club_id is required')
  const confirmed = body.confirmed === true

  const supabase = await createServiceClient()
  const { error } = await supabase
    .from('venue_signals')
    .update({ asked: true, confirmed })
    .eq('user_id', user!.id)
    .eq('club_id', String(body.club_id))
    .eq('asked', false)

  if (error) return err(error.message)
  return ok({ confirmed })
}
