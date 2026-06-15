import { createServiceClient } from '@/lib/supabase/server'
import { ok, err } from '@/lib/utils'
import { normalizeInviteCode } from '@/lib/url'
import { rateLimit, clientIp } from '@/lib/ratelimit'

// GET /api/groups/preview/[code] — PUBLIC, unauthenticated preview of an invite
// so a logged-out person can see what they're being invited to before signing
// in. Returns ONLY non-sensitive fields: club name/photo, date, organizer's
// first name, headcount, and whether it's free. No member list, no PII, no ids.
//
// Security posture:
//   • Validates the code format (no traversal / wildcards / oversized lookups).
//   • Best-effort per-instance rate limit to blunt code brute-forcing.
//   • Generic 404 for unknown codes (no enumeration signal).
//   • no-store: never cache an invite at the edge.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!rateLimit(`preview:${clientIp(req)}`, 30, 60_000)) {
    return err('Too many requests', 429)
  }

  const { code: raw } = await params
  const code = normalizeInviteCode(raw)
  if (!code) return err('Invite not found', 404)

  const sb = await createServiceClient()

  const { data: group } = await sb
    .from('booking_groups')
    .select(`
      id, organizer_id, booking_type, booking_date, status,
      clubs ( name, cover_image_url, general_entry_price, vip_table_min_spend )
    `)
    .eq('invite_code', code)
    .maybeSingle()

  if (!group) return err('Invite not found', 404)

  const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
  const isFree = group.booking_type === 'general' && !(Number(club?.general_entry_price) > 0)

  // Headcount of confirmed members (no identities exposed).
  const { count } = await sb
    .from('booking_group_members')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', group.id)
    .eq('rsvp', 'going')

  // Organizer's FIRST name only — never the full guest list to a stranger.
  const { data: organizer } = await sb
    .from('users')
    .select('full_name')
    .eq('id', group.organizer_id)
    .maybeSingle()
  const organizerFirstName = (organizer?.full_name ?? '').trim().split(/\s+/)[0] || null

  return ok({
    club_name:        club?.name ?? null,
    cover_image_url:  club?.cover_image_url ?? null,
    booking_date:     group.booking_date,
    booking_type:     group.booking_type,
    status:           group.status,
    is_free:          isFree,
    going_count:      Math.max(count ?? 0, 1),
    organizer_first:  organizerFirstName,
  })
}
