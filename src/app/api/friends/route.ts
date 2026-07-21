import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { FriendUser } from '@/types'

// Cross-user reads (friend names) are blocked by per-user RLS on public.users,
// so these routes use the service client and scope every query by the authed id.

interface FriendshipRow {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
}

// GET /api/friends — { friends, incoming, outgoing }
export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id

  const sb = await createServiceClient()

  const { data: rows, error } = await sb
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
  if (error) {
    // Most common failure mode: the friendships migration hasn't been applied.
    if (/relation .* does not exist|schema cache/i.test(error.message)) {
      return err('Friends is not set up yet — run the friendships migration in Supabase.', 503)
    }
    return err(error.message)
  }

  const edges = (rows ?? []) as FriendshipRow[]
  const otherId = (r: FriendshipRow) => (r.requester_id === me ? r.addressee_id : r.requester_id)

  const ids = edges.map(otherId)
  const profiles = new Map<string, { full_name: string | null; avatar_url: string | null }>()
  if (ids.length) {
    const { data: users } = await sb
      .from('users')
      .select('id, full_name, avatar_url')
      .in('id', ids)
    for (const u of users ?? []) profiles.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url })
  }

  const toFriend = (r: FriendshipRow): FriendUser => {
    const id = otherId(r)
    const p = profiles.get(id)
    return { id, full_name: p?.full_name ?? null, avatar_url: p?.avatar_url ?? null, friendship_id: r.id }
  }

  return ok({
    friends:  edges.filter(r => r.status === 'accepted').map(toFriend),
    incoming: edges.filter(r => r.status === 'pending' && r.addressee_id === me).map(toFriend),
    outgoing: edges.filter(r => r.status === 'pending' && r.requester_id === me).map(toFriend),
  })
}

const requestSchema = z.object({ addressee_id: z.string().uuid() })

// POST /api/friends — send a friend request (or auto-accept a reverse request)
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id

  const parsed = requestSchema.safeParse(await request.json())
  if (!parsed.success) return err('addressee_id required')
  const other = parsed.data.addressee_id
  if (other === me) return err('You cannot add yourself')

  const sb = await createServiceClient()

  // Confirm the target exists
  const { data: target } = await sb.from('users').select('id').eq('id', other).maybeSingle()
  if (!target) return err('User not found', 404)

  // Existing relationship in either direction?
  const { data: existingRows } = await sb
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`and(requester_id.eq.${me},addressee_id.eq.${other}),and(requester_id.eq.${other},addressee_id.eq.${me})`)
  const existing = (existingRows ?? [])[0] as FriendshipRow | undefined

  const myName = await displayName(sb, me)

  if (existing) {
    if (existing.status === 'accepted') return ok({ status: 'accepted', friendship_id: existing.id })
    // They already requested me → accept it instead of creating a duplicate.
    if (existing.addressee_id === me) {
      const { error: upErr } = await sb
        .from('friendships')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (upErr) return err(upErr.message)
      await notify({ user_id: other, type: 'friend_accept', title: `${myName} accepted your friend request`, link: '/friends', push: 'clubfuoco' })
      return ok({ status: 'accepted', friendship_id: existing.id })
    }
    // I already requested them
    return ok({ status: 'pending', friendship_id: existing.id })
  }

  const { data: created, error: insErr } = await sb
    .from('friendships')
    .insert({ requester_id: me, addressee_id: other, status: 'pending' })
    .select('id')
    .single()
  if (insErr) {
    if (/relation .* does not exist|schema cache/i.test(insErr.message)) {
      return err('Friends is not set up yet — run the friendships migration in Supabase.', 503)
    }
    return err(insErr.message)
  }

  await notify({ user_id: other, type: 'friend_request', title: `${myName} sent you a friend request`, link: '/friends', push: 'clubfuoco' })
  return ok({ status: 'pending', friendship_id: created.id }, 201)
}

const deleteSchema = z.object({ friendship_id: z.string().uuid() })

// DELETE /api/friends — unfriend, cancel a sent request, or decline
export async function DELETE(request: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id

  const parsed = deleteSchema.safeParse(await request.json())
  if (!parsed.success) return err('friendship_id required')

  const sb = await createServiceClient()
  const { error } = await sb
    .from('friendships')
    .delete()
    .eq('id', parsed.data.friendship_id)
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
  if (error) return err(error.message)
  return ok({ removed: true })
}

async function displayName(sb: Awaited<ReturnType<typeof createServiceClient>>, id: string): Promise<string> {
  const { data } = await sb.from('users').select('full_name').eq('id', id).maybeSingle()
  return data?.full_name?.trim() || 'Someone'
}
