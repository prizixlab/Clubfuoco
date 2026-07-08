import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { resolveTokenToAllocation } from '@/lib/promoter-series'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'

// POST /api/promoter-invites/[token]/invite-friends
// Body: { user_ids: string[] } — notify each selected friend with the claim
// link so they can RSVP to this guestlist and claim their own spot.
// Only ACCEPTED friends of the caller may be targeted, so this can't be used
// to spam arbitrary users.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { token } = await params

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.user_ids)
    ? body.user_ids.filter((x: unknown): x is string => typeof x === 'string')
    : []
  if (!ids.length) return err('No friends selected', 400)

  const sb = await createServiceClient()

  // Validate the token points at a real night, and grab a name for the copy.
  const resolved = await resolveTokenToAllocation(sb, token)
  if (!resolved) return err('Invite not found', 404)
  const { data: alloc } = await sb
    .from('promoter_allocations')
    .select('night:promoter_nights(title, location_name)')
    .eq('id', resolved.allocationId)
    .single()
  const nightRow = Array.isArray(alloc?.night) ? alloc?.night[0] : alloc?.night
  const venue = (nightRow as { title?: string; location_name?: string } | null)?.title
    || (nightRow as { location_name?: string } | null)?.location_name
    || 'a night out'

  // Restrict targets to the caller's accepted friends.
  const { data: fr } = await sb
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
  const friendIds = new Set((fr ?? []).map(r => (r.requester_id === me ? r.addressee_id : r.requester_id)))
  const targets = [...new Set(ids)].filter(id => id !== me && friendIds.has(id)).slice(0, 25)
  if (!targets.length) return err('No valid friends to invite', 400)

  const { data: meRow } = await sb.from('users').select('full_name').eq('id', me).maybeSingle()
  const myName = meRow?.full_name?.trim() || 'A friend'

  await Promise.all(targets.map(uid => notify({
    user_id: uid,
    type: 'guestlist_invite',
    title: `${myName} invited you to ${venue}`,
    body: 'Tap to grab your spot on the guestlist.',
    link: `/i/${token}`,
  })))

  return ok({ sent: targets.length })
}
