import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ok, err } from '@/lib/utils'
import { NextRequest } from 'next/server'
import { z } from 'zod'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// True if `me` is the organizer or a member of the group. Chat is members-only.
async function isMember(sb: SB, groupId: string, me: string): Promise<boolean> {
  const { data: group } = await sb
    .from('booking_groups')
    .select('organizer_id')
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return false
  if (group.organizer_id === me) return true
  const { data: row } = await sb
    .from('booking_group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', me)
    .maybeSingle()
  return !!row
}

// GET /api/groups/[id]/messages?since=<iso> — the group's chat thread.
// Returns messages oldest→newest (capped), optionally only those after `since`
// for lightweight polling. Opening the thread marks it read for the viewer.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id: groupId } = await params

  const sb = await createServiceClient()
  if (!(await isMember(sb, groupId, me))) return err('Group not found', 404)

  const since = request.nextUrl.searchParams.get('since')
  let query = sb
    .from('booking_group_messages')
    .select('id, user_id, body, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (since) query = query.gt('created_at', since)

  const { data: rows, error } = await query
  if (error) return err(error.message)

  const messages = rows ?? []
  const senderIds = Array.from(new Set(messages.map(m => m.user_id)))
  const names = new Map<string, { full_name: string | null; avatar_url: string | null }>()
  if (senderIds.length) {
    const { data: users } = await sb.from('users').select('id, full_name, avatar_url').in('id', senderIds)
    for (const u of users ?? []) names.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url })
  }

  // Mark the thread read for the viewer (no-op if they have no member row,
  // e.g. an organizer whose row was never created).
  await sb
    .from('booking_group_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('user_id', me)

  return ok(messages.map(m => ({
    id: m.id,
    user_id: m.user_id,
    sender_name: names.get(m.user_id)?.full_name ?? null,
    sender_avatar_url: names.get(m.user_id)?.avatar_url ?? null,
    body: m.body,
    created_at: m.created_at,
    is_mine: m.user_id === me,
  })))
}

const postSchema = z.object({ body: z.string().trim().min(1).max(2000) })

// POST /api/groups/[id]/messages — send a message to the group thread.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuth()
  if (response) return response
  const me = user!.id
  const { id: groupId } = await params

  const parsed = postSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('Message body is required (max 2000 chars)')

  const sb = await createServiceClient()
  if (!(await isMember(sb, groupId, me))) return err('Group not found', 404)

  const { data: row, error } = await sb
    .from('booking_group_messages')
    .insert({ group_id: groupId, user_id: me, body: parsed.data.body })
    .select('id, user_id, body, created_at')
    .single()
  if (error) return err(error.message)

  // The sender has now seen everything up to their own message.
  await sb
    .from('booking_group_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('user_id', me)

  const { data: profile } = await sb
    .from('users')
    .select('full_name, avatar_url')
    .eq('id', me)
    .maybeSingle()

  return ok({
    id: row.id,
    user_id: row.user_id,
    sender_name: profile?.full_name ?? null,
    sender_avatar_url: profile?.avatar_url ?? null,
    body: row.body,
    created_at: row.created_at,
    is_mine: true,
  })
}
