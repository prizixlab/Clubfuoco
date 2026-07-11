import type { createServiceClient } from '@/lib/supabase/server'
import type { GroupDetail, GroupMember } from '@/types'

type SB = Awaited<ReturnType<typeof createServiceClient>>

// Assemble a full GroupDetail (group + club + members + viewer's membership).
// Used by the [id] and code resolve routes. Returns null if the group is gone.
export async function getGroupDetail(sb: SB, groupId: string, meId: string): Promise<GroupDetail | null> {
  const { data: group } = await sb
    .from('booking_groups')
    .select(`
      id, club_id, organizer_id, booking_type, booking_date, invite_code, status,
      clubs ( name, cover_image_url, general_entry_price, vip_table_min_spend )
    `)
    .eq('id', groupId)
    .maybeSingle()
  if (!group) return null

  const club: any = Array.isArray(group.clubs) ? group.clubs[0] : group.clubs
  const unitPrice = group.booking_type === 'vip'
    ? (club?.vip_table_min_spend ?? 0)
    : (club?.general_entry_price ?? 0)

  const { data: memberRows } = await sb
    .from('booking_group_members')
    .select('id, user_id, role, rsvp, payment_required, amount_due, paid, booking_id, last_read_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  const rows = memberRows ?? []
  const ids = Array.from(new Set([group.organizer_id, ...rows.map(r => r.user_id)]))
  const profiles = new Map<string, { full_name: string | null; avatar_url: string | null }>()
  if (ids.length) {
    const { data: users } = await sb.from('users').select('id, full_name, avatar_url').in('id', ids)
    for (const u of users ?? []) profiles.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url })
  }

  // The viewer's own entry is a normal booking — surface its id + QR so the
  // app can show that member's distinct pass / wallet pass. Only ever for the
  // viewer (each member has their own separately-generated pass).
  const myBookingId = rows.find(r => r.user_id === meId)?.booking_id ?? null
  let myQrToken: string | null = null
  if (myBookingId) {
    const { data: booking } = await sb
      .from('bookings')
      .select('qr_code_token')
      .eq('id', myBookingId)
      .maybeSingle()
    myQrToken = booking?.qr_code_token ?? null
  }

  // Resolve what each member actually owes: a custom allocation if the organizer
  // set one, otherwise the club's per-person price when they're a payer, else 0.
  const resolveCharge = (amountDue: number | null, paymentRequired: boolean): number =>
    amountDue != null ? Number(amountDue) : (paymentRequired ? unitPrice : 0)

  const members: GroupMember[] = rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    full_name: profiles.get(r.user_id)?.full_name ?? null,
    avatar_url: profiles.get(r.user_id)?.avatar_url ?? null,
    role: r.role,
    rsvp: r.rsvp,
    payment_required: r.payment_required,
    amount_due: r.amount_due != null ? Number(r.amount_due) : null,
    charge: resolveCharge(r.amount_due, r.payment_required),
    paid: r.paid,
    is_me: r.user_id === meId,
    booking_id: r.user_id === meId ? (r.booking_id ?? null) : null,
    qr_token: r.user_id === meId ? myQrToken : null,
  }))

  // Unread chat = messages posted after the viewer last opened the thread,
  // excluding their own. `last_read_at` null → everything from others counts.
  const myRow = rows.find(r => r.user_id === meId)
  const lastRead = (myRow as { last_read_at?: string | null } | undefined)?.last_read_at ?? null
  let unreadQuery = sb
    .from('booking_group_messages')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .neq('user_id', meId)
  if (lastRead) unreadQuery = unreadQuery.gt('created_at', lastRead)
  const { count: unreadCount } = await unreadQuery

  return {
    id: group.id,
    club_id: group.club_id,
    club_name: club?.name ?? 'Club',
    club_image: club?.cover_image_url ?? null,
    organizer_id: group.organizer_id,
    organizer_name: profiles.get(group.organizer_id)?.full_name ?? null,
    booking_type: group.booking_type,
    booking_date: group.booking_date,
    invite_code: group.invite_code,
    status: group.status,
    unit_price: unitPrice,
    members,
    me: members.find(m => m.is_me) ?? null,
    unread_count: unreadCount ?? 0,
  }
}

// Short, unambiguous invite code (no easily-confused chars).
export function generateInviteCode(len = 6): string {
  // CSPRNG (not Math.random) so codes aren't predictable. Rejection-sample to
  // keep a uniform distribution over the 32-char alphabet.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) {
    let b = bytes[i]
    // 256 isn't a multiple of 32, but 32 divides 256 evenly (256/32 = 8), so
    // a plain modulo is already uniform here — no rejection needed.
    out += alphabet[b % alphabet.length]
  }
  return out
}
