import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'

// ── Who may manage a guest list ──────────────────────────────────────────────
//
// The guest-list routes run on the service role, so RLS protects nothing there:
// these checks are the only thing between the internet and every signup's
// name, email and phone, or a list being edited, deleted, or checked in. A
// list belongs to its club, and a club is managed by its `club_staff` rows —
// the same link /api/club-dashboard uses.

type Sb = Awaited<ReturnType<typeof createServiceClient>>
type Gate = { user: User; response: null } | { user: null; response: NextResponse }

function forbidden(): NextResponse {
  return NextResponse.json({ data: null, error: 'Forbidden' }, { status: 403 })
}

async function isClubStaff(sb: Sb, userId: string, clubId: string | null | undefined): Promise<boolean> {
  if (!clubId) return false
  const { data } = await sb
    .from('club_staff').select('club_id')
    .eq('user_id', userId).eq('club_id', clubId)
    .maybeSingle()
  return !!data
}

/** Signed in AND staff at the club this guest list belongs to. */
export async function requireListStaff(sb: Sb, listId: string): Promise<Gate> {
  const { user, response } = await requireAuth()
  if (response) return { user: null, response }
  const { data: list } = await sb.from('guest_lists').select('club_id').eq('id', listId).maybeSingle()
  // Same answer for "no such list" and "not yours", so ids can't be probed.
  if (!list || !(await isClubStaff(sb, user!.id, list.club_id))) return { user: null, response: forbidden() }
  return { user: user!, response: null }
}

/** Signed in AND staff at this club. */
export async function requireClubStaff(sb: Sb, clubId: string | null | undefined): Promise<Gate> {
  const { user, response } = await requireAuth()
  if (response) return { user: null, response }
  if (!(await isClubStaff(sb, user!.id, clubId))) return { user: null, response: forbidden() }
  return { user: user!, response: null }
}
