import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok } from '@/lib/utils'
import { NextRequest } from 'next/server'
import type { FriendRelation, FriendSearchResult } from '@/types'

// GET /api/friends/search?q= — find users by name or email to add as friends.
// Returns each match with the current relationship so the UI can show the right
// action (Add / Pending / Accept / Friends). Email is used for matching only,
// never returned.
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id

  const raw = (request.nextUrl.searchParams.get('q') ?? '').trim()
  // Strip characters that have meaning inside PostgREST .or()/ilike filters.
  const q = raw.replace(/[%,()*]/g, ' ').trim()
  if (q.length < 2) return ok([] as FriendSearchResult[])

  const sb = await createServiceClient()

  const { data: matches } = await sb
    .from('users')
    .select('id, full_name, avatar_url')
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .neq('id', me)
    // Promoter accounts (Fuoco For Promoters identities) are not consumers and
    // must not surface in friend search. Null-safe so ordinary users whose
    // account_kind was never set still appear.
    .or('account_kind.is.null,account_kind.neq.promoter')
    .limit(15)

  const results = matches ?? []
  if (!results.length) return ok([] as FriendSearchResult[])

  // Map existing relationships in a single query.
  const { data: rels } = await sb
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)

  const relFor = (otherId: string): { relation: FriendRelation; friendship_id: string | null } => {
    const r = (rels ?? []).find(
      x => (x.requester_id === me && x.addressee_id === otherId) ||
           (x.addressee_id === me && x.requester_id === otherId),
    )
    if (!r) return { relation: 'none', friendship_id: null }
    if (r.status === 'accepted') return { relation: 'friends', friendship_id: r.id }
    return { relation: r.requester_id === me ? 'outgoing' : 'incoming', friendship_id: r.id }
  }

  const out: FriendSearchResult[] = results.map(u => ({
    id: u.id,
    full_name: u.full_name,
    avatar_url: u.avatar_url,
    ...relFor(u.id),
  }))
  return ok(out)
}
